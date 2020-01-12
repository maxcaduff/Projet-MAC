
# DB
CREATE DATABASE remote:localhost/BestOption root MacProject20
CREATE USER Bot IDENTIFIED BY MacProject20 ROLE admin  


# VERTICES
CREATE CLASS    User      EXTENDS V
CREATE PROPERTY User.name STRING
CREATE PROPERTY User.id   INTEGER
ALTER  PROPERTY User.name NOTNULL TRUE
ALTER  PROPERTY User.id   NOTNULL TRUE

CREATE CLASS    Poll          EXTENDS  V
CREATE PROPERTY Poll.question STRING
CREATE PROPERTY Poll.date     DATETIME 
CREATE PROPERTY Poll.public   BOOLEAN
CREATE PROPERTY Poll.closed   BOOLEAN
CREATE PROPERTY Poll.creator  LINK USER
ALTER  PROPERTY Poll.date     DEFAULT "SYSDATE()"

CREATE CLASS    Answer      EXTENDS V
CREATE PROPERTY Answer.text STRING

CREATE CLASS    Tag      EXTENDS V
CREATE PROPERTY Tag.name STRING


# EDGES
CREATE CLASS    AnsweredPoll           EXTENDS E
CREATE PROPERTY AnsweredPoll.out       LINK User
CREATE PROPERTY AnsweredPoll.in        LINK Poll
CREATE PROPERTY AnsweredPoll.anonymous BOOLEAN

CREATE CLASS    Voted      EXTENDS E
CREATE PROPERTY Voted.out  LINK User
CREATE PROPERTY Voted.in   LINK Answer
CREATE PROPERTY Voted.vote INTEGER

CREATE CLASS    PollAnswer     EXTENDS E
CREATE PROPERTY PollAnswer.out LINK Poll
CREATE PROPERTY PollAnswer.in  LINK Answer

CREATE CLASS    HasTag     EXTENDS E
CREATE PROPERTY HasTag.out LINK Poll
CREATE PROPERTY HasTag.in  LINK Tag








