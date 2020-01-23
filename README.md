Caduff Max, Thomas Benjamin

# <center> MAC Project </center>
## Telegram majority judgement bot

### Purpose
This bot has been created as part of the MAC course at HEIG-VD. It implements the [majority judgement](https://en.wikipedia.org/wiki/Majority_judgment) (MJ), which is a still-not-perfect-but-better voting system than traditional "which is the best". MJ allows to rate each option with a grade from bad to excellent, and uses the median and some computations to choose the option best liked by most.

### Specification

A user should be able to:

* create a poll, public or private, with a question and options to evaluate
* share the poll with a selected audience
* vote and change his votes until the poll is closed
* obtain detailled polls results when the poll is closed
* search public and his polls, with support of keywords to filter and sort results

### Constraints

* a private poll can only be visible by the people to whom it has been shared with
* everyone can have a unique set of votes for a given poll.

### Choice of technologies

__Mail client__: Telegram, which has a rich API for managing bots.

__Database__: OrientDB, graph database, allowing you to easily manage the links between surveys, users, responses and tags.

__Server back end__: Express, which allows you to create a javascript server responding to requests.

### User interaction
The bot is initiated with the command "/start". This registers the user in the database and allows to create and answer polls.

Users can create a poll with the command "/create. They are then prompted to choose privacy parameter, some tags if the poll is public, write the question and the answers options.  
When entering tags, if close existing tag are found, the user is asked if he wants to use one of them or create his.

Polls can be public or private. Public polls are searchable by everyone (with the help of keywords), private polls must be shared with a user or a group to allow them to see it and participate. After answering a poll, the user decides if his vote is anonymous or not (names will be displayed or just the number of answers).

Users can access their different created polls by typing the command "/mypolls", the 5 last created polls are returned, with a button to fetch next if any. (hack: you can directly access page N with /mypollsN, 0 being the first)

Polls must be closed prior to see the results. Only the creator can close the poll. A future update could implement a delay after which the poll automatically closes. When the poll is closed, a message with the results is sent by the bot to each participants.  
Sharing a closed poll also sends results.

Searching polls is possible by typing @BestOptionBot \<query\>, with filtering keywords (starting with #) and free terms matched against the different fields:  #tag, #question and #option are used to match specifically all the normal words following those keywords with the corresponding fields, and #latest (default, not very useful), #oldest, #popular or #unpopular to sort results by these criterias, and #limit X (X∈[1;30]) to limit to X results. Other words starting with # are ignored, and the input is cleaned from anything not being a #/digit/letter.

Actually votes being anonymous or not is useless, we could implement a button along the results to display an editable message with statistics and public voters for each option.

In the future, the creator might also be able to change the five ratings that the users use to rate choices. Actually, only preset choices are available (bad, poor, fair, good, excellent, no opinion).

### Implementation

All queries and messages to the bot are sent via a webhook to a fixed url. To get those we use the help of ngrok who redirects a local port to a generated subdomain on their server. Responses and updates sent by the bot are transmitted to a telegram address containing the api key of the bot and a specific path.

Poll creation and voting process are taking multiple iterations, so those states are kept between queries in 2 maps with the user's telegram id as key and containing all useful infos. The maps themselves are saved on the disk as json when the server exits, and are loaded on start. This is designed to store only valid polls and votes in the database, so prevents numerous checks to the database at all steps to ensure the informations are valid, and is fastly accessible. Only one voting/creation state is allowed per user, a warning is displayed if a user wants to start a poll without finishing to answer another one. The only bad point for now being that no mechanism is implemented yet to flush the maps after a certain time if the user doesn't finish, so with a high number of users it could lead to memory issues. Another viable solution would have been to create another table in the DB to store the temporary informations and transfer it when finished.

Updates sent by telegram are json objects with different fields depending on the source of the update. We handle 3 types of queries:   

- Messages sent by a user, directly or with a click on a non-inline keyboard (which sends its content as message and disappears). They can be commands (/cmd) or free text.
- Inline queries (@BotName ...), sent each time the user changes the input, giving an easy way to show the user one ore more results in a responsive way. If the user clicks on one of the displayed results, it will be sent as a message.
- Callback queries, sent by a click on an inline keyboard (persistant keyboard attached to a message), containing the command and the message to which it was attached (except for messages sent via inline queries results).

The poll creation process is handled with simple messages, since the input is mainly free, storing the new informations provided by the user in the creationState map along the process. Input is checked at each step of the process so the poll is in a valid state when the user finishes. Only at this moment the poll is created in the database. New tags are matched against existing to guarantee uniqueness.

The voting process is handled with callback queries, those sending exactly the query associated with the keyboard button clicked, only state consistency checks are needed (no user input). On a vote request, the associated message is edited with the current answer to evaluate and the keyboard displays the rating scale. When the user chooses a grade, the vote is recorded in an array and the next option is displayed. When the process is complete, if the user already voted his votes are updated, otherwise they are created and the message is refreshed with the default keyboard.

Sharing polls can be done only with inline queries allowing users to post a message via the bot. When clicking on a share button, the poll's id is inserted in the query so the user only has to click the result to display it in the selected chat. Since messages are visible by everyone in a group, a button redirecting the user to a chat with the bot allows him to vote. This button has a start parameter indicating the poll; since the command is /start, the user is also registered in the database.

Searching for polls also uses inline queries, all the query content is sent each time the user changes the input, the message is parsed and the corresponding results are sent back to the user.  
It could also have been implemented with standard messages, but it would have resulted in a lot of long messages, using inline queries allows to dynamically display multiple results without polluting the chat and to send any result in any chat. The searching strategy is exposed below.

### Data Model

![Alt text](dataModel.PNG)

We opted for this model because it seemed to correspond best to the schema to which we wanted to structure our data. Indeed, it seemed logical to us to represent the users, the polls, the options, as well as the tags that we added in order to facilitate searches, as vertices. Everything else is only after relationships between the vertices, each of the edges representing a link between a user and a poll, a tag and a poll, a user and an answer, etc...

### Advanced queries

The following rules are applied:  

###### sorting
* \#tags and #options are synomyms for resp. #tag and #option.
* only the last of either #popular or #unpopular is taken into account, it filters results by number of people having voted.
* if one or more #oldest are present, results are filtered by oldest poll creation date.  
* the following sorting order is applied:
  * number of matching tags if #tag is present
  * number of matching options if #option is present
  * number of votes if #popular or #unpoular are present
  * poll creation date, oldest first if #oldest is present, otherwise latest date is the default always applied.

###### filtering
* keywords #question, #option and #tag must be followed by one ore more simple words, otherwise they are ignored.   
* with #question, the whole group of next words must be contained as a sentence in the question.
* in #tag and #option, each of the following words is searched in the corresponding field (like %term% is used to fetch all fields including the term), and a score is calculated as the number of matching fields. Those queries are by default ordered by their score. 
* For #tag, OR is used between terms to give a higher score to polls with tags matching the most terms
* for #option AND is used between terms to match them all in the same option, this makes more sense since options can be sentences while tags are short. See below to search for more terms in other options.
* only one #question and one #tag are allowed, all others are discarded and the following words if any are treated as simple terms. 
* multiple #option are allowed to look for other groups terms in the options, since all terms following this tag are matched with an AND against the option text, every other #option tag is ORed with the previous one(s). This permits to give a higher score to polls containing options matching most patterns.
* simple terms not being valid arguments for keywords are searched individually in: the questions (contains), the tags (exact match) and the options (exact match). OR is used between all these clauses so that any match returns a result, but the whole simple terms part is ANDed with the other filters, so that it reduces the total result set. The exact match part could be improved by refactoring the existing code to allow using the parts building the tags and options subqueries with simple words to get partial matches.
* \#limit X can be used to limit the number of results, the default is 5, authorized values are 1-30, valid integers out of this range will be set to the closest limit. Only the last #limit is taken into account.



### Backend launching steps

* start orientDb: you can either use docker or a local install (see [orientDb docs](https://orientdb.com/docs/last/Tutorial-Installation.html)).
* launch the database creation script, either with the console or execute the content with the web interface provided by orientDb.
* start ngrok to redirect your port 8080 (`$ ngrok http 8080`)
* set the new ngrok address for the webhook e.g. with postman (see [Telegram API](https://core.telegram.org/bots/api#setwebhook)) ![example with Postman](postmanWhatToDo.PNG)

__from the backend folder:__ (`$ cd path/to/project/backend/`)

* get your api key from [Botfather](https://t.me/botfather) and set it (`$ echo 'yourKey' > apiKey`), you thought I'd give mine?=p  
* Enable inline queries by typing the command `/inline`, choose your bot in the list and enter the placeholder.  
* change the botName variable by your bot username in bestOption.js  
* launch the express server : `$ npm install; npm start`. Alternatively to npm start, `$ npm run dev` launches nodemon (`$ npm i -g nodemon` to install) which reloads on changes.
