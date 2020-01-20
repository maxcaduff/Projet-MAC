const express = require('express');
const fetch = require('node-fetch');
const orientDB = require('orientjs');
const fs = require('fs');


const ODB = orientDB({
	host: 'localhost',
	port: 2424,
	username: 'root',
	password: 'MacProject20'
});
const db = ODB.use({
	name: 'BestOption',
	username: 'Bot',
	password: 'MacProject20'

});

const url = 'https://api.telegram.org/bot' + fs.readFileSync('./apiKey').toString().replace(/\s/g,''); 
const app = express();

app.use(express.json());

let creationState = new Map();
let voteState = new Map();
const rates = ['no opinion', 'bad', 'poor', 'fair', 'good', 'excellent'];
const emojisRates = ['','😡','😠','😐','😊','😀'];
const pageSize = 5;
const botName = 'BestOptionBot';



// getting saved state:
JSON.parse(fs.readFileSync('./creationStateBackup.json')).reduce((m, [key, val])=> m.set(key, val) , creationState);
JSON.parse(fs.readFileSync('./voteStateBackup.json')).reduce((m, [key, val])=> m.set(key, val) , voteState);
//debug ('fetched votestate' , ...voteState);

// all updates are sent to the same road, no way to have different paths ='(
app.post('/', (req, res) => {
  
  res.sendStatus(200);
  
  (async () => {
  
    // handling simple messages
    if (req.body.message) {
      const chatId = req.body.message.chat.id;
      const user = req.body.message.from.id;
      const receivedMsg = req.body.message.text;
      
      // phases: 0: public / priv, 1: tags, 2: question, 3: answers/end
      let userState = creationState.get(user);
      
      // if poll is being created:
      if (userState && !receivedMsg.match(/\/start.*/)) { // allowing to answer a poll even if not finished to create one
        
        const askQuestion = 'Now tell me your question, it should be as precise as possible, remember that people will evaluate each option with a choice between "bad" and "excellent".';
        
        if (receivedMsg === '/abort' || receivedMsg === '/exit') {
          sendMessage(chatId, 'Okay, try again when you like.');
          creationState.delete(user);
        }
        else if (userState.phase === 0) {
          
          if (receivedMsg.toLowerCase() === 'public') {
            userState.public = true;
            userState.phase = 1;
            sendMessage(chatId, 'Good, give some tags (one by one) to help people find your poll. Only letters, numbers and dashes are allowed. Send "/end" or "/enough" when done.');
            userState.allTags = await db.select('name', '@rid as id').from('Tag').all();
          }
          else if (receivedMsg.toLowerCase() === 'private') {
            userState.public = false;
            userState.phase = 2;
            sendMessage(chatId, 'Okay! ' + askQuestion);
          }
          else {
            sendMessage(chatId, 'this is not an option.');
          }
          creationState.set(user, userState);
        }
        else if (userState.phase === 1) { // entering tags
          
          let nextTagMsg = 'enter another tag or send "/end" or "/enough" when done.';
          if (receivedMsg === '/end' || receivedMsg === '/enough') {
            if (userState.tags.length < 1) {
              sendMessage(chatId, 'Not enough tags, please enter at least 1.');
            }
            else {
              // finished keywords
              sendMessage(chatId, 'tags are: ' + userState.tags.map(tag => tag.name).join(', ') +'\n\n'+ askQuestion);
              userState.phase = 2;
              creationState.set(user, userState);
            }
          }
          else if (receivedMsg[0] === '/') {
            // received an answer to displayed alternative tags
            const query = parseQuery (receivedMsg);
            
            // debug('query parsed', query);
            
            if (query.cmd === '/use') {
              userState.tags.push(userState.allTags.filter(tag => tag.name.toLowerCase() === query.tag)[0]);
              nextTagMsg = 'Okay, ' + nextTagMsg;
            }
            else if (query.cmd === '/create') {
              userState.tags.push({name: query.tag});
              nextTagMsg = 'Okay, ' + nextTagMsg;
            }
            else {
              nextTagMsg = '*Error*, ' + nextTagMsg;
            }
            creationState.set(user, userState);
            sendMessage(chatId, nextTagMsg);
          }
          else {
            // stripping unallowed chars
            let receivedTag = receivedMsg.replace(/[^a-z0-9-]/gi,'').toLowerCase();
            
            if (receivedTag.length < 3) {
              sendMessage(chatId, 'Your tag is too short, minimum 3 characters.');
              return;
            }
            // calculating Levenshtein distance to match closest tags
            let minDist = receivedTag.length ;
            let closestTags = [];
            for (let tag of userState.allTags) {
              const dist = stringDistance (tag.name, receivedTag);
              if (dist < minDist) {
                closestTags = [tag];
                minDist = dist;
              }
              else if (dist === minDist) {
                closestTags.push(tag);
              }
            }
            if (minDist === 0 || closestTags.length === 0 || (receivedTag.length > 4 && minDist > receivedTag.length / 2) ) {
              //tag exists or has no alternative or is bigger than 4 char and has less than half its size in common
              userState.tags.push(minDist === 0 ? closestTags[0] : {name: receivedTag});
              sendMessage(chatId, nextTagMsg);
            }
            else {
              // let user choose among closest tags
              let keyboard = [];
              for (let tag of closestTags) {
                keyboard.push(['/use '+ tag.name]);
              }
              keyboard.push(['/create ' + receivedTag])
              sendMessage(chatId, 'Your input is similar to existing tag(s), would you like to use an existing tag or create yours anyway?', keyboard);
            }
            creationState.set(user, userState);
          }
        }
        else if (userState.phase === 2) { // entering question
          userState.question = receivedMsg.replace(/[\*_]/g,'');
          
          if (userState.question.length < 10) {
            sendMessage(chatId, 'Your question is too short! I said _precise_... (Even "how do you rate..." is longer 😉)');
          }
          else {
            userState.answers = [];
            userState.phase = 3;
            sendMessage(chatId, 'So your question is: '+ receivedMsg + '\n\nNow please enter the first choice:');
            creationState.set(user, userState);
          }
        }
        else if (userState.phase === 3) { // entering choices
          if (receivedMsg === '/end' || receivedMsg === '/enough') {
            if (userState.answers.length < 2) {
              sendMessage(chatId, 'Not enough choices for a poll! Please enter at least 2 options.');
            }
            else {
              
              // finished, storing in db
              const rid = await getUserRid (user);
              const newPoll = await db.create('VERTEX', 'Poll').set({
                question: userState.question,
                public: userState.public,
                closed: false,
                creator: rid
              }).one();
              
              for (let tag of [...new Set(userState.tags)]) { // removing duplicates if any
                let newTag = null;
                if (! tag.id) {
                  newTag = await db.create('VERTEX', 'Tag').set({name: tag.name}).one();
                }
                await db.create('EDGE', 'HasTag').from(newPoll['@rid']).to(newTag ? newTag['@rid'] : tag.id).one();
              }
              
              for (let answer of userState.answers) {
                let newAnswer = await db.create('VERTEX', 'Answer').set({text: answer}).one();
                await db.create('EDGE', 'PollAnswer').from(newPoll['@rid']).to(newAnswer['@rid']).one();
              }
              
              let poll = await getDisplayablePoll(newPoll['@rid'], user);
              sendMessage(chatId, poll.text, poll.keyboard, true);
              creationState.delete(user);
            }
          }
          else {
            const newAnswer = receivedMsg.replace(/[\*_]/g,'');
            if (newAnswer.length < 2) {
              sendMessage(chatId, 'Answer too short, try again.');
              return;
            }
            userState.answers.push(newAnswer);
            sendMessage(chatId, 'enter another choice or send "/end" or "/enough" when done.');
            creationState.set(user, userState);
          }
        }
      }
      
      // no poll being created or user willing to vote for a poll (/start pollId)
      else {
        
        if (receivedMsg.match(/\/start.*/)) {
          
          // check db and create user if needed
          const rid = await getUserRid (user);
          if (!rid) {
            
            await db.create('VERTEX', 'User').set({name: req.body.message.from.first_name, id: user}).one();
          }
          
          let pollId = receivedMsg.substring(7);
          if (pollId.match(/\d+\-\d+/)) {
            // clicked vote from shared poll, displaying poll to vote or results if closed.
            // forging a callback_query to edit the freshly sent message as if user clicked on vote since we can't vote from shared messages -> genius.
            pollId = '#' + pollId.replace('-', ':');
            
            const pollInfo = await getBasicPollInfo (pollId);
            if (pollInfo.closed) {
              const results = await getPollResults(pollId);
              sendMessage(chatId, results.text, results.keyboard, true);
            }
            else {
              const poll = await getDisplayablePoll(pollId, user);
              const sentMsg = await sendMessage(chatId, poll.text, poll.keyboard, true);
              req.body.callback_query = {from: req.body.message.from, message: sentMsg.result, data: '/startVote ' + pollId};
            }
          }
          else {
            sendMessage(chatId, 'Hello, you can create a new poll with /create, or get some help with /help');
          }
        }
        
        else if (receivedMsg === '/help') {
          sendMessage(chatId, `*Available commands are:*
/create : Create a new poll  
/help : I hope you already know ;)  
/mypolls : Get your polls
Click the button below to search for public polls. You can use specified keywords and free search terms.
*Keywords are:*
#latest OR #oldest, #mostAnswers OR #leastAnswers, #before yyyy-mm-dd HH:mm, #after yyyy-mm-dd HH:mm`, [[{text: 'search public polls', switch_inline_query_current_chat: '/search'}]], true);
          
        }
        
        // TODO opt: create /myAnswers to get answered polls
        
        // displaying user polls by page
        else if (receivedMsg.match(/\/mypolls\d*/)) {

          const page = parseInt(receivedMsg.substr(8)) || 0;
          const polls = await db.select('question', 'date', 'closed', '@rid as rid').from('Poll')
                .where({'creator.id': user}).order('date desc').skip(page * pageSize).limit(pageSize).all();
          let nb = await db.select('count(*)').from('Poll').where({'creator.id': user}).one();
          nb = nb.count;
            
          const isLastPage = page < Math.floor(nb/pageSize);
          let msg = page === 0 ? `*Your created ${nb} polls:*\n\n` : `*Page ${page} of your polls:* \n\n`;
          
          for (let poll of polls) {

            msg += `\- *${poll.question}* \- Poll is ${poll.closed? 'closed.': 'open.'}
created on: ${poll.date.toString().slice(0,21)}   /view${ poll.rid.toString().substring(1).replace(':','\\_') }\n\n`;
          }
          msg += isLastPage ? 'Click this button to get next page of results:' : 'This is all we got.';
          // TODO opt: would be nice to request the next page with an inline button to edit the text: [[{text: 'next page', callback_data: '/page 1'}]]
          sendMessage (chatId, msg, ( isLastPage ? [['/myPolls'+(page+1)]] : null));
        }
        // getting 1 poll
        else if (receivedMsg.match(/\/view\d+_\d+/)) {
          const id = '#' + receivedMsg.substr(5).replace('_', ':');
          const poll = await getDisplayablePoll(id, user);
          sendMessage (chatId, poll.text, poll.keyboard, true);
        }
        
        else if (receivedMsg === '/create') {
          sendMessage(chatId, 'Let\'s begin, you can abort anytime with /abort or /exit.  \nSo, is it a public or private poll? Public polls must have tags and are searchable by everyone', [['public', 'private']]);
          creationState.set(user, {phase: 0, tags: []});
        }
        else {
          sendMessage(chatId, 'What you say?');
        }
        
      }
    }
    // replies to @BestOptionBot ...  queries
    if (req.body.inline_query){
      
      const query = parseQuery (req.body.inline_query.query);
      let results = [];
      
      // if /send #id -> display only this poll
      if (query.cmd === '/share') {
        
      //checking if poll exists
        const exists = await db.select('count(*) as cnt', 'question', 'closed').from('Poll')
			                         .where({'@rid': query.poll}).one();
        if (exists.cnt > 0) {
          
          let msg, key;
          // if poll is closed display only results.
          if (exists.closed) {
            const results = await getPollResults(query.poll);
            msg = `${req.body.inline_query.from.first_name} shared poll: *"${exists.question}"* with you. ${results.text.substr(results.text.indexOf('Here are'))}`;
            key = results.keyboard;
          } 
          else {
            const poll = await getDisplayablePoll (query.poll);
            msg = poll.text;
            // changing buttons, since no msg is sent in an inline update.(Must answer poll in chat with bot)
            key = poll.keyboard.slice(0,2);
            delete key[1][0].callback_data;
            key[1][0].url = 'telegram.me/' + botName + '?start=' + query.poll.substring(1).replace(':', '-');
          }
            
          results.push( { id: query.poll, 
                          input_message_content: {message_text: msg, parse_mode: 'markdown'},
                          type: "article",
                          title: exists.question,
                          reply_markup: {inline_keyboard: key}
                       });
        }
      }
      
      // TODO high: handle search with keywords (#latest, #popular, etc) 
      else{
        
        parsedTerms = req.body.inline_query.query.split(' ');
        let query = `SELECT @rid as rid, count( in(AnsweredPoll)), date, question, public, closed FROM Poll WHERE (creator = ${req.body.inline_query.from.id} OR public = true)`
        let queryMiddle = parseQuerySearch(parsedTerms, 0);

        if(queryMiddle.orderBy == undefined){           //Default order by date ASC
          queryMiddle.orderBy =  `  GROUP BY @rid ORDER BY date ASC`;
        }

        if(queryMiddle.middle != ``){
          query += ` AND ( ` + queryMiddle.middle +  ` ) `;
        }

        console.log(query + queryMiddle.orderBy);
        let result = await db.query(query + queryMiddle.orderBy);
        
        if (result != undefined && result.length > 0) {
          
          let msg, key;

          for (var i = 0; i < result.length; i++) {
          

            const poll = await getDisplayablePoll (result[i].rid);
            msg = poll.text;

            key = [[{text: `share${poll.closed ? ' results':''}`, switch_inline_query: `/share ${result[i].rid}`}]];
           
            results.push( { id: result[i].rid, 
                            input_message_content: {message_text: msg, parse_mode: 'markdown'},
                            type: "article",
                            title: result[i].question,
                            reply_markup: {inline_keyboard:   key}
            });
            
          }  
          
        }

      }
  
      if (results.length === 0) {
        // TODO low set better default answer: send 5 latest public polls?
        
//        results.push(  {id: "help", 
//                        input_message_content: {message_text: "help!"},
//                        type: "article",
//                        title: "click me to get help",
//                        url: "google.com"
//                       })
      }
      debug('results', results)
      answerInline (req.body.inline_query.id, results);
    }
    
    // handling callback buttons voting process
    if (req.body.callback_query && req.body.callback_query.message) { // callback from a non-inline message
      
      const chatId = req.body.callback_query.message.chat.id;
      const msgId = req.body.callback_query.message.message_id;
      const user = req.body.callback_query.from.id;
      const callbackMsg = parseEntities(req.body.callback_query.message);
      let query = parseQuery (req.body.callback_query.data);  
      let userVote = voteState.get(user);
      let userVoteState;
      let msg = '';
      let keyboard = [];
      let notifBody = '';
      
      if (query.cmd === '/close') {
        // closing poll and sending results to everyone participating
        await db.update("Poll").set({closed: true}).where({'@rid': query.poll}).one();
        notifBody = 'poll was closed.';
        
        const results = await getPollResults (query.poll);
        const participants = await db.select('out.id as id').from('AnsweredPoll').where({'in': query.poll}).all();
        for (let user of participants) {
          sendMessage(user.id, results.text, results.keyboard, true);
        }
        query.cmd = '/update';
      }
      
      switch (query.cmd) {
          
          // TODO opt: /showResults #poll (only if showing temp results is allowed.)
          // TODO low: command to check who voted for what via button attached to answers. (sends updatable message with answers on a callback keyboard to check results for each, otherwise message way too long. Format: Answer: X, no opinion: bob, bill & 12 others, bad: ... )
        
        case '/startVote':
          // TODO low: check if existing voteState -> warning (you already started to answer poll "title" but didn't submited results)
          notifBody = `let's begin!`;
          userVoteState = await getVoteState(user, query.poll);
          const answers = await db.select('out("PollAnswer").@rid as rids', 'out("PollAnswer").text as texts')
            .from('Poll').where({ "@rid": query.poll}).one();
  
          msg = callbackMsg + `\n=============================================

*Please rate: ${answers.texts[0]}*
${ userVoteState.voted? '_You already voted. This will erase your previous results._' : '' }`;
          keyboard = [[{text: 'no opinion', callback_data: '/vote 0' },{text: 'bad', callback_data: '/vote 1'}],
                         [{text: 'poor', callback_data: '/vote 2' },{text: 'fair', callback_data: '/vote 3'}],
                         [{text: 'good', callback_data: '/vote 4' },{text: 'excellent', callback_data: '/vote 5'}],
                         [{text: 'abort', callback_data: '/abort ' + query.poll }]];
          
          
          voteState.set(user, {poll: query.poll, ansRids: answers.rids, ansTxts: answers.texts, votes: [], step: 0});
          break;
          
        case '/vote':
          
          // TODO low: check if !userVote -> error (shouldn't happen with the state save)
          notifBody = `you rated: ${rates[query.vote]} for "${userVote.ansTxts[userVote.step]}"`;
          userVote.votes.push(query.vote);
          userVote.step ++;
  
          if (userVote.step >= userVote.ansRids.length) {
            // finished, prompt anonymous or not
            msg = callbackMsg.substring(0, callbackMsg.indexOf('*Please rate: ')+1) + 'Anonymous answers?*';
            keyboard = [[{text: 'yes', callback_data: '/anonymous true'}, {text: 'no', callback_data: '/anonymous false'}],[{text: 'abort', callback_data: '/abort ' + userVote.poll }]]
          }
          else {
            // editing message with next option
            msg = callbackMsg.substring(0, callbackMsg.indexOf('*Please rate: ')+14) + userVote.ansTxts[userVote.step]+ '*';
            keyboard = req.body.callback_query.message.reply_markup.inline_keyboard;
          }
          voteState.set(user, userVote);   
          break;
          
        case '/anonymous':
        
          // TODO low: check if uservote is null -> error (but shouldn't happen)
          
          // checking if poll not already closed:
          const pollState = await getBasicPollInfo(userVote.poll);
          
          if (pollState.closed) {
            notifBody = 'Sorry, poll is closed, you cannot submit votes anymore. ';
          }
          else {
            notifBody = `Your vote is ${query.anon?'':'not '}anonymous. You completed the poll, thanks.\n`;
            const userRid = await getUserRid(user);
            userVoteState = await getVoteState(user, userVote.poll);
            let previousVotes = await getVotes(user, userVote.poll);

            for (let i = 0; i < userVote.ansRids.length; i++) {
    
              if (userVoteState.voted) {
                //await db.query('update '+previousVotes.rid+' set vote='+userVote.votes[i]);
                const j = userVote.ansTxts.indexOf(previousVotes[i].answer);
                await db.update("Voted").set({vote: userVote.votes[j]}).where({'@rid': previousVotes[i].rid}).one();
              }
              else {
                await db.create('EDGE', 'Voted').from(userRid).to(userVote.ansRids[i]).set({vote: userVote.votes[i]}).one();
              }
            }
            if (! userVoteState.voted) {
              await db.create('EDGE', 'AnsweredPoll').from(userRid).to(userVote.poll).set({anonymous: query.anon}).one();
            }
            else if (userVoteState.anonymous !== userVote.anon) {
              await db.update(userVoteState.rid).set({anonymous: query.anon}).one();
            } 
          }
          
        case '/abort':
          voteState.delete(user);
             
        case '/update':
          
          notifBody += 'Poll refreshed.'
          let poll = await getDisplayablePoll(query.poll || userVote.poll, user);
          msg = poll.text;
          keyboard = poll.keyboard;
        
      }
      sendTo('/answerCallbackQuery', {callback_query_id: req.body.callback_query.id, text: notifBody});
      updateMsg(chatId, msgId, msg, keyboard);
    }

    
  })();
    
});




/************* FUNCTIONS **************/


// sends a message, keyboard and inline are optionals.
async function sendMessage (chat, msg, keyboard, inline) {
  
  let resp = {chat_id: chat,
              text: msg,
              parse_mode: 'markdown'};
  if (keyboard) {
    resp.reply_markup = inline ? {inline_keyboard: keyboard}
                        : {keyboard: keyboard, resize_keyboard: true, one_time_keyboard: true};  
  }
  else {
    resp.reply_markup = {remove_keyboard: true};
  }
  return await sendTo ('/sendMessage', resp);
};

// updates a message with keyboard
async function updateMsg (chatId, msgId, newMsg, keyboard) {
  
  const resp = {chat_id: chatId,
              message_id: msgId,
              text: newMsg,
              parse_mode: 'markdown',
              reply_markup: {inline_keyboard: keyboard}
            };
  return await sendTo ('/editMessageText', resp);
};

// answer to inline queries with results array
async function answerInline (query, results) {
  
  const resp = {
                inline_query_id: query,
                results: results
               };
  return await sendTo ('/answerInlineQuery', resp);
};

// sends any body to the specified route
async function sendTo (route, body) {
  try {
    const rawResponse = await fetch( url + route, {
	 		method: 'post',
      headers: { 'Content-Type': 'application/json' },
	 		body: JSON.stringify(body)
	 	});

    //debug('send resp to '+ url+route, await rawResponse.json());
    return await rawResponse.json();
  }
	catch (err) { 
    debug ('error while sending', err.toString());
  }
};


async function getUserRid (user) {
  let result = await db.select('@rid').from('User')
			.where({id: user}).one();

  if ( !result || !result.rid) return null;
  return result.rid ;
};

async function getVoteState(userId, pollRid) {
  
  const rep = await db.select('count(*)', 'anonymous', '@rid as rid').from('AnsweredPoll').where( {in: pollRid, 'out.id': userId}).one();
  return {voted: rep.count > 0, anonymous: rep.anonymous, rid: rep.rid};
};

async function getVotes (userId, pollRid) {
  // query not working, apparently out/in("Edge") doesn't work in where...: select @rid as rid, vote, in.text as option from Voted where out.id=ID and in.in('PollAnswer').@rid='#NB'
  //return await db.select('@rid as rid', 'vote', 'in.text as option').from('Voted').where( {'out.id': userId, 'in.in("PollAnswer")': pollRid}).all();
  
  return await db.query('select @rid as rid, vote, in.text as answer from Voted where out.id='+userId+' and in in (select in from PollAnswer where out="'+pollRid+'")');
};

// TODO low check what is really needed for search, for now only 'question' and 'closed' used.
async function getBasicPollInfo (pollId) {
  return await db.select('question', 'public', 'closed').from('Poll').where({'@rid': pollId}).one();
};


// returns formatted question and answers, along with inline keyboard to take actions.
async function getDisplayablePoll (pollRid, userId) {
  
  let poll = await db.query( 'select @rid as rid, question, date, public, closed, creator.name as creator, creator.id as creatorId, out("PollAnswer").text as answers, out("HasTag").name as tags, $votes.cnt as nbVotes from Poll let $votes=(select count(*) as cnt from AnsweredPoll where in="'+pollRid+'") where @rid="'+pollRid+'"');
  poll = poll[0];
  
  let userVoteState = {};
  let votes;
  if (userId) {
    userVoteState = await getVoteState(userId, pollRid);
    if (userVoteState.voted) {
      votes = await getVotes(userId, pollRid);
    }
  }
  const voted = userVoteState.voted;
  // setting message
  let msg = `_Poll created on: ${poll.date.toString().slice(0,21)}     by: ${poll.creator}_ 

*${poll.question}*  

*Answers to evaluate:*  
\- *`;
  for (let i = 0; i < poll.answers.length; i++) {
    msg += (voted ? votes[i].answer : poll.answers[i] )+ `* ${voted? ' \-> you rated: '+ rates[votes[i].vote] : ''}  
${ i+1 < poll.answers.length ? '\- *' : '\n'}`;
  }
  if (voted) {
    msg += `your vote is: ${userVoteState.anonymous? 'anonymous' : 'public'}\n`;
  }
  msg += `Nb of voters${poll.closed ? '': ' so far'}: ${poll.nbVotes[0]}.  Poll is ${poll.closed? 'closed': 'open'}.
${ poll.tags.length === 0 ? '': '*Tags:* ' + poll.tags.join(', ')}\n`;
  
  // setting keyboard
  let keyboard = [[{text: `share${poll.closed ? ' results':''}`, switch_inline_query: `/share ${pollRid}`}]];
  if (! poll.closed) {
    keyboard.push([{text: (userVoteState.voted? 'edit ':'')+'vote', callback_data: `/startVote ${pollRid}` }]);
    keyboard.push([{text: 'update', callback_data: `/update ${pollRid}`}]);
    if (userId && poll.creatorId === userId) {
      keyboard.push([{text: 'close poll', callback_data: `/close ${pollRid}`}]);
    }
  }

  return {text: msg, keyboard: keyboard};
}

// computing results for a specific poll
async function getPollResults (pollId) {
  
  // query working in studio but returning wtf results here, fuck you orientDb: `select in.text as option, vote, count(vote) as cnt from Voted where in in (select in from PollAnswer where out="${pollId}") group by option, vote`
  const results = await db.query(`select in.text as option, vote from Voted where in in (select in from PollAnswer where out="${pollId}")`);
  
  let compute = {};
  // counting total votes for each option
  for (let result of results) {
    if (!compute[result.option]) {
      compute[result.option] = {answer: result.option, nbGrades: [0,0,0,0,0,0], percents: [0], totalVotes: 0, median: 0 };
    }
    compute[result.option].nbGrades[result.vote] ++; // = result.cnt;
    if (result.vote !== 0) { // not counting white votes for computations
      compute[result.option].totalVotes ++; // += result.cnt;
    }
  }
  
  let maxMedian = 0;
  let bestMedians = [];
  const poll = await getBasicPollInfo (pollId);
  let msg = `Poll *"${poll.question}"* was closed. Here are the final results: \n\n`; 
  
  for (let option in compute) {
    let opt = compute[option];
    let cumulate = 0;
    msg += `*${opt.answer}:*\nNb of ratings: ${opt.totalVotes}  and ${opt.nbGrades[0]} whites votes. *Median: `;
    let line = '';
    let emojis = '';
    let nbEmojisPut = 0;
    
    // iterating on nbGrades and percent tables
    for (let i = 1; i < 6; i++) { 
      // computing votes percentages for each option
      opt.percents.push (opt.totalVotes ? opt.nbGrades[i] / opt.totalVotes : 0 );
      cumulate += opt.percents[i];
      // setting median when cumulate percentages reach 50%
      if (!opt.median && cumulate >= 0.5) {
        opt.median = i;
      }
      // formatting message
      line += `${rates[i]}: ${(opt.percents[i] *100).toFixed(1) }%${i < 5 ? ', ': '.\n'}`;
      let nbEmojis = Math.round(cumulate * 20) - nbEmojisPut ;
      emojis += emojisRates[i].repeat(nbEmojis);
      nbEmojisPut += nbEmojis;
    }
    msg += rates[opt.median] + '*\n' + line + emojis + '\n\n';
    
    // getting best option(s)
    if (maxMedian < opt.median) {
      bestMedians = [opt];
      maxMedian = opt.median;
    }
    else if (maxMedian === opt.median) {
      bestMedians.push(opt);
    }
  }
  msg += `Best median grade is: *${ rates[maxMedian]}*. ${bestMedians.length > 1 ?
    'Tied options: _'+bestMedians.map(el=>el.answer).join('_, _') + '_. MJ uses the closest grade to settle tied options.' : '' }\n`;
  
  // discriminating tied best options
  let higherFound = false;
  for (let tied of bestMedians) { // finding closest mention
    tied.lower = tied.percents.slice(0,tied.median).reduce((acc, val) => acc + val, 0);
    tied.higher = tied.percents.slice(tied.median + 1).reduce((acc, val) => acc + val, 0);
    tied.closest = tied.lower > tied.higher ? 'lo' : 'hi';
    if (tied.closest === 'hi') higherFound = true;
  }
  // settles between equal options, useful only for small nb of answers.
  // checks median size, if equality: checks nb of votes, if equality: checks answer % of 2 worst mentions, if equality: first result is sent ^^' (but very rare case in practice except for very small nb of answers.)
  function settleEquality (cur, prev) {
    return  cur.percents[maxMedian] > prev.percents[maxMedian] || (
            cur.percents[maxMedian] === prev.percents[maxMedian] && (
              cur.totalVotes > prev.totalVotes || (
              cur.totalVotes === prev.totalVotes && (
                cur.percents[1] < prev.percents[1] ||
                cur.percents[1] === prev.percents[1] &&
                  cur.percents[2] < prev.percents[2] )))); // only checking 2 worst mentions, can go up to 4 (if median is 5)
  }
  
  // getting MJ results (find closest mention, if no highest mention -> lowest lo wins, else highest hi wins.)
  let mjWinner;
  if (higherFound) {
    mjWinner = bestMedians.reduce((prev, cur) =>( cur.closest === 'hi' && ( prev.higher < cur.higher || ( 
                                    prev.higher === cur.higher && settleEquality(cur, prev) )) ?  cur : prev ));
  }
  else {
    mjWinner = bestMedians.reduce((prev, cur) => ( cur.closest === 'lo' && ( prev.lower > cur.lower || (
                                      prev.lower === cur.lower && settleEquality(cur, prev) ))  ?  cur : prev ));
  }
  
  msg += `*Best Option according to Majority Judgement: ${mjWinner.answer}*.\n\n`;
  
  // reporting closest from sup mention (better option for most) and furthest from lower (less disliked) if different than mjWinner
  const absHi = bestMedians.map(el=>[el]).reduce((prev, cur) => (prev[0].higher < cur[0].higher) ? cur : (prev[0].higher === cur[0].higher ? (prev.push(cur[0]), prev) : prev ));
  const absLo = bestMedians.map(el=>[el]).reduce((prev, cur) => (prev[0].lower > cur[0].lower) ? cur : (prev[0].lower === cur[0].lower ? (prev.push(cur[0]), prev) : prev ));
  
  if ( !absHi.includes(mjWinner) || !absLo.includes(mjWinner) ) {

    msg += `You might want to consider the option${absHi.length > 1 ? 's':''} with *absolute closest higher mention* (better for most voters): ${absHi.map(el=>el.answer).join(', ') }, and the option${absLo.length > 1 ? 's':''} with *smallest lower mention* (less disliked): ${absLo.map(el=>el.answer).join(', ') }. `;
  }
  msg += 'Keep in mind that MJ only takes into account the percentage of higher and lower ratings regarding the median grade, not which grade it is, nor the distribution of other rates. Human re-evaluation might be needed in some cases, that\'s why you get detailled percentages. 😉';
  
  //debug('compute', compute);
  return { text: msg, keyboard: [[{text: 'share results', switch_inline_query: `/share ${pollId}`}]] };
};


// currently only bold and italic supported (not overlapped)
function parseEntities (msg) {
  let parsed = '';
  let lastPos = 0;
  
  for (let entity of msg.entities) {
    const format = entity.type === 'bold' ? '*' : '_';
    parsed += msg.text.substring(lastPos, entity.offset) + format 
              + msg.text.substr(entity.offset, entity.length) + format;
    lastPos = entity.offset + entity.length;
  }
  parsed += msg.text.substring(lastPos);
  return parsed;
}

// parsing user or callback queries (format: '/cmd arg')
function parseQuery (query) {
  let parsed = {};
  parsed.cmd = query.substring(query.indexOf('/'), query.indexOf(' '));
  
  switch (parsed.cmd) { 
    case '/vote':
      parsed.vote = parseInt(query.substring(query.indexOf(' ') +1));
      break;
    case '/use':
    case '/create':
      parsed.tag = query.substring(query.indexOf(' ') +1);
      break;
    case '/anonymous':
      parsed.anon = query.substring(query.indexOf(' ')+1 ) === 'true';
      break;
    default:
      parsed.poll = query.substring(query.indexOf('#'));
      break;
  }
  return parsed;
};


//parsing user queries (format: #latest #question wordToSearch)
function parseQuerySearch(parsedTerms, index){

  let queryMiddle, tmp;

  queryMiddle ={};
  queryMiddle.orderBy = undefined;
  queryMiddle.middle = ``;

  
  
    if(index < parsedTerms.length){
      switch(parsedTerms[index]){
        
        case "#oldest":
          queryMiddle.orderBy =  `  GROUP BY @rid ORDER BY date ASC`;
          index++;
          if(index < parsedTerms.length){
            tmp = parseQuerySearch(parsedTerms, index);
            queryMiddle.middle += tmp.middle;
          }
          break;
        case "#latest":
          queryMiddle.orderBy =  `  GROUP BY @rid ORDER BY date DESC`;
          index++;
          if(index < parsedTerms.length){
            tmp = parseQuerySearch(parsedTerms, index);
            queryMiddle.middle += tmp.middle;
          }
          break;
        case "#popular":
          queryMiddle.orderBy =  ` GROUP BY @rid ORDER BY cnt DESC`;
          index++;
          if(index < parsedTerms.length){
            tmp = parseQuerySearch(parsedTerms, index);
            queryMiddle.middle += tmp.middle;
          }
          break;
        case "#tag":
          index++;
          while(index < parsedTerms.length && parsedTerms[index][0] != '#'){
            if(parsedTerms[index] != ""){
              if(checkingFirstChar(parsedTerms, index)){ //Verify that there is not several # in a row
                queryMiddle.middle += ` OR `
              }
              
              queryMiddle.middle += `(` +  "\"" + parsedTerms[index] + "\"" + ` IN out("HasTag").name) `;
              
            }
            index++;
          }
          tmp = parseQuerySearch(parsedTerms, index);
          queryMiddle.middle += tmp.middle;
          queryMiddle.orderBy = tmp.orderBy;
          break;
        case "#question":
          index++;
          while(index < parsedTerms.length && parsedTerms[index][0] != '#'){
            if(parsedTerms[index] != ""){
              if(checkingFirstChar(parsedTerms, index)){ //Verify that there is not several # in a row
                queryMiddle.middle += ` AND `
              }
              
              queryMiddle.middle += `(question containsText ` + "\"" + parsedTerms[index]  + "\"" + `) `;
              
            }
            index++;
          }
          tmp = parseQuerySearch(parsedTerms, index);
          queryMiddle.middle += tmp.middle;
          queryMiddle.orderBy = tmp.orderBy;
          break;
        case "#option":
          index++;
          while(index < parsedTerms.length && parsedTerms[index][0] != '#'){
            
            if(parsedTerms[index] != ""){
              if(checkingFirstChar(parsedTerms, index)){ //Verify that there is not several # in a row
                queryMiddle.middle += ` OR `
              }
              
              queryMiddle.middle += `(` +  "\"" + parsedTerms[index] + "\"" + ` IN out("PollAnswer").text) `;
              
            }
            index++;
          }
          tmp = parseQuerySearch(parsedTerms, index);
          queryMiddle.middle += tmp.middle;
          queryMiddle.orderBy = tmp.orderBy;
          break;
        default:
          while(index < parsedTerms.length && parsedTerms[index][0] != '#'){
            
            if(parsedTerms[index] != ""){
              if(index != 0 && checkingFirstChar(parsedTerms, index)){ //Verify that there is not several # in a row
                queryMiddle.middle += ` OR `
              }
              
              queryMiddle.middle += `(` +  "\"" + parsedTerms[index] + "\"" + ` IN out("HasTag").name) OR `
              queryMiddle.middle += `(question containsText ` + "\"" + parsedTerms[index]  + "\"" + `) OR `;
              queryMiddle.middle += `(` +  "\"" + parsedTerms[index] + "\"" + ` IN out("PollAnswer").text) `;
            
            }
            
            index++;
          }
          try{
            tmp = parseQuerySearch(parsedTerms, index);
          }catch(RangeError){
            console.log("RangeError");
          }
          queryMiddle.middle += tmp.middle;
          queryMiddle.orderBy = tmp.orderBy;
          break;
      }
      //debug("results", results);
    }
  
    console.log(queryMiddle)
  

  return queryMiddle;

}

//Check the first char of the array till the index index to see if all the first char are # (ex: ([#latest, #tag, #question, is, there], 2) = false)
function checkingFirstChar(parsedTerms, index){
  let count = 0;
  while(count < index){
    if(parsedTerms[count] != "" && parsedTerms[count][0] != '#'){
      return true;
    }
    ++count;
  }
  return false;
}



// computes the levenstein distance for 2 words
function stringDistance (str1, str2) {
  function getScore (i, j) {
    if (i===0) return j;
    else if (j===0) return i;
    else
      return Math.min (getScore(i-1,j)+1, getScore(i,j-1)+1, getScore(i-1,j-1) 
                       + ( str1[i-1].toLowerCase() === str2[j-1].toLowerCase() ? 0 : 1) );
  }
  return getScore(str1.length, str2.length);
};




let server = app.listen(8080, function(){
	console.log("BE accepts req on port 8080.");
});


function saveState(signal) {
  console.log(`Received ${signal}`);
  fs.writeFileSync('creationStateBackup.json', JSON.stringify([...creationState.entries()]));
  fs.writeFileSync('voteStateBackup.json', JSON.stringify([...voteState.entries()]));
  
  server.close();
  // resending same signal
  process.kill (process.pid, signal);
  
}
process.once('SIGINT', saveState);
process.once('SIGTERM', saveState);
// used by nodemon to restart app
process.once('SIGUSR2', saveState);



app.get('/test', function(req,res){
  //res.sendStatus(200);
  
  getPollResults('#27:3').then ( result => {
    
  res.json(result) ;
  })
  
});


function debug (text, obj) {
  console.log(text + ' - ' + JSON.stringify(obj));
};





