var AWS = require('aws-sdk');
var doc = require('dynamodb-doc');
var dynamo = new doc.DynamoDB();
var sns = new AWS.SNS();

var alexaCallback;

exports.handler = function (event, context) {
    try {
        console.log("event.session.application.applicationId=" + event.session.application.applicationId);

        /**
         * Prevent someone else from configuring a skill that sends requests to this function.
         */
        //if (event.session.application.applicationId !== "<CHANGE ME TO YOUR ALEXA SKILL KIT APP ID>") {
        //     context.fail("Invalid Application ID");
        //}

        if (event.session.new) {
            onSessionStarted({requestId: event.request.requestId}, event.session);
        }

        if (event.request.type === "LaunchRequest") {
            onLaunch(event.request,
                event.session,
                function callback(s, speechletResponse) {
                    context.succeed(buildResponse(sessionAttributes, speechletResponse));
                });
        } else if (event.request.type === "IntentRequest") {
            onIntent(event.request,
                event.session,
                function callback(sessionAttributes, speechletResponse) {
                    context.succeed(buildResponse(sessionAttributes, speechletResponse));
                });
        } else if (event.request.type === "SessionEndedRequest") {
            onSessionEnded(event.request, event.session);
            context.succeed();
        }
    } catch (e) {
        context.fail("Exception: " + e);
    }
};

/**
 * Called when the session starts.
 */
function onSessionStarted(sessionStartedRequest, session) {
    console.log("onSessionStarted requestId=" + sessionStartedRequest.requestId +
        ", sessionId=" + session.sessionId);
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(launchRequest, session, callback) {
    console.log("onLaunch requestId=" + launchRequest.requestId +
        ", sessionId=" + session.sessionId);

    // Dispatch to your skill's launch.
    getWelcomeResponse(callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, session, callback) {
    console.log("onIntent requestId=" + intentRequest.requestId +
        ", sessionId=" + session.sessionId);

    var intent = intentRequest.intent,
        intentName = intentRequest.intent.name;

    // Dispatch to your skill's intent handlers
    if ("PourBeer" === intentName) {
        pourBeer(intent, session, callback);
    } else if ("AMAZON.HelpIntent" === intentName) {
        getWelcomeResponse(callback);
    } else if ("AMAZON.StopIntent" === intentName || "AMAZON.CancelIntent" === intentName) {
        handleSessionEndRequest(callback);
    } else {
        throw "Invalid intent";
    }
}

/**
 * Called when the user ends the session.
 * Is not called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(sessionEndedRequest, session) {
    console.log("onSessionEnded requestId=" + sessionEndedRequest.requestId +
        ", sessionId=" + session.sessionId);
    // Add cleanup logic here
}

// --------------- Functions that control the skill's behavior -----------------------

function getWelcomeResponse(callback) {
    // If we wanted to initialize the session to have some attributes we could add those here.
    var sessionAttributes = {};
    var cardTitle = "Welcome";
    var speechOutput = "Welcome to the Beer App. " +
        "You can now request that I pour a beer.";
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    var repromptText = "You can say, beer me.  Or, please pour the next beer.";
    var shouldEndSession = false;

    callback(sessionAttributes,
        buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function handleSessionEndRequest(callback) {
    var cardTitle = "Session Ended";
    var speechOutput = "Thank you for trying the beer app. Have a nice day!";
    // Setting this to true ends the session and exits the skill.
    var shouldEndSession = true;

    callback({}, buildSpeechletResponse(cardTitle, speechOutput, null, shouldEndSession));
}


function pourBeer(intent, session, callback) {
    var cardTitle = intent.name;
    var sessionAttributes = {};
    var shouldEndSession = true;
    
    speechOutput = "I am now pouring your beer.";
    repromptText = "I did not pour your beer.  Please try again.";
    
    startKegFlow();
    
    alexaCallback = function() {
        callback(sessionAttributes, buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
    };
}


// --------------- Helpers that build all of the responses -----------------------

function buildSpeechletResponse(title, output, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: "PlainText",
            text: output
        },
        card: {
            type: "Simple",
            title: "SessionSpeechlet - " + title,
            content: "SessionSpeechlet - " + output
        },
        reprompt: {
            outputSpeech: {
                type: "PlainText",
                text: repromptText
            }
        },
        shouldEndSession: shouldEndSession
    };
}

function buildResponse(sessionAttributes, speechletResponse) {
    return {
        version: "1.0",
        sessionAttributes: sessionAttributes,
        response: speechletResponse
    };
}

// --------------- Helpers for flow to DynamoDB, SNS -----------------------

function startKegFlow() {
    var scanParams = {
        TableName: "BeerRequests",
    };

    console.log("Scanning BeerRequests table.");
    dynamo.scan(scanParams, onScan);    
}

function onScan(err, data) {
    if (err) {
        console.error("Unable to scan the table. Error JSON:", JSON.stringify(err, null, 2));
    } else {
        // print all the requests
        console.log("Scan succeeded.");
        console.log("Got " + data.Items.length + " numbers.");
        data.Items.forEach(function(entry) {
           console.log(entry.PhoneNumber);
        });

        // choose one at random
        var choice = Math.floor(Math.random() * (data.Items.length));
        var chosenNumber = data.Items[choice].PhoneNumber;
        console.log("Choosing number " + choice + ".");
        console.log("Phone: " + chosenNumber);

        var phoneNumberOut = chosenNumber.substring(0, 3) + '-' + chosenNumber.substring(3, 6) + '-' + chosenNumber.substring(6, 10);
        
        // send message to texterator
        sns.publish({
            Message: '{"phone":"' + phoneNumberOut + '"}',
            TopicArn: '<CHANGE ME TO YOUR SNS TOPIC ARN>'
        }, function(err, data) {
            if (err) {
                console.log(err.stack);
                return;
            }
            // delete it
            var deleteParams = {
                TableName: "BeerRequests",
                Key:{
                    "PhoneNumber":chosenNumber
                }
            };

            console.log("Attempting delete...");
            dynamo.deleteItem(deleteParams, function(err, data) {
                if (err) {
                    console.error("Unable to delete item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    console.log("DeleteItem succeeded:", JSON.stringify(data, null, 2));
                    alexaCallback();
                }
            });
        });
    }
}
