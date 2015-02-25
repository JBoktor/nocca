'use strict';

var _ = require('lodash');
var $http = require('http');
var $url = require('url');
var $urlPattern = require('url-pattern');
var $scenarioRecorder = require('../scenarioRecorder');
var $scenario = require('../scenario');

module.exports = {};
module.exports.createServer = createServer;

// Configured routes will be collected in this map
var routes = {
    direct: {},
    pattern: []
};

// Setup the HTTP server and use the request router to handle all traffic
function createServer (config) {

    return $http.createServer(createRequestRouter(config))
        .listen(config.server.port, function () {
            console.log('HTTP server listening on port ' + config.server.port);
        });

}

// Wraps the request router in a closure to provide access to the configuration
function createRequestRouter (config) {

    var router = requestRouter;
    router.config = config;

    return router;

    // Selects handlers from the routes map (routes are defined below)
    function requestRouter (req, res) {

        var route = req.method.toUpperCase() + ':' + $url.parse(req.url).pathname;

        if (routes.direct.hasOwnProperty(route)) {
            routes.direct[route](req, res, config);
        }
        else {
            var match, handler;
            console.log(match);
            for (var idx = 0; idx < routes.pattern.length && !match; idx++) {
                if (match = routes.pattern[idx].match(route)) {
                    handler = routes.pattern[idx].handler;
                }
            }
            console.log(match);

            if (typeof handler !== 'undefined') {
                handler(req, res, config, match);
            }
            else {
                res.writeHead(404, 'Not found', {
                    'Access-Control-Allow-Origin': '*'
                });
                res.write('Could not open ' + req.url, function() {
                    res.end();
                });
            }
        }

    }

}

// --- Route definitions

// Adds a handler to the routes map using one or more route definitions (first argument can be an array)
// Route definitions are of the form METHOD:/p/a/t/h
// Further specialization on query parameters or headers is not provided
function route(routeStrings, isPattern, handler) {
    if (typeof handler === 'undefined') { handler = isPattern; isPattern = false; }
    if (!_.isArray(routeStrings)) { routeStrings = [routeStrings]; }
    routeStrings.forEach(function(r) {
        if (isPattern) {
            var p = $urlPattern.newPattern(r);
            p.handler = handler;
            routes.pattern.push(p);
        }
        else {
            routes.direct[r] = handler;
        }
    });
}

route('GET:/caches', function getCaches(req, res, config) {
    res.write(JSON.stringify(config.playback.exporter(), null, 2), function () {
        res.end();
    });
});

route('POST:/caches', function addCaches(req, res, config) {
    res.write('ayeee you gave me caches to add!', function () {
        res.end();
    });
});

route('PUT:/caches', function replaceCaches(req, res, config) {
    res.write('ayeee you gave me fresh caches!', function () {
        res.end();
    });
});

route('POST:/caches/package', function addCachePackage(req, res, config) {
    var body = '';

    req.on('data', function (chunk) {
        body += chunk;
    });

    req.on('end', function () {

        if (body !== '') {
            try {
                body = JSON.parse(body);
            }
            catch (e) {
                res.writeHead(400, 'Bad request', {
                    'Access-Control-Allow-Origin': '*'
                });
                res.write('Request body could not be parsed, is it a valid JSON string?');
                res.end();
            }
        }


        // parse body and extract requested keys
        if (body === '') {
            body = {};
        }

        var recordings = router.config.playback.exporter();

        // extract from recordings
        var downloadObj = {};

        if (typeof body.requestKeys !== 'undefined') {
            body.requestKeys.forEach(function (value) {
                downloadObj[value] = recordings[value];
            });
        }
        else {
            // if no keys specified just download all recorded
            downloadObj = recordings;
        }


        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        });

        res.write(JSON.stringify(downloadObj), function () {
            res.end();
        });

    });
});

route('GET:/enums/scenarios/type', function (req, res) {
    res.write(JSON.stringify($scenario.TYPE), function() { res.end(); });
});

route('GET:/enums/scenarios/repeatable', function (req, res) {
    res.write(JSON.stringify($scenario.REPEATABLE), function() { res.end(); });
});

route('GET:/scenarios/:scenarioKey', true, function(req, res, config, params) {
    res.write('You asked for scenario: ' + params.scenarioKey, function() { res.end(); });
});

route('GET:/scenarios/:scenarioKey/active', true, function(req, res, config, params) {
    res.write('You asked for the status of scenario: ' + params.scenarioKey, function() { res.end(); });
});

route('POST:/scenarios/startRecording', function startRecordingScenario(req, res, config) {
    try {
        var parsedUrl = $url.parse(req.url);
        var title = (parsedUrl.query && parsedUrl.query.title) ? parsedUrl.query.title : undefined;
        
        $scenarioRecorder.startRecordingScenario(title);
        res.write('Started recording', function() {
            res.end();
        });
    } catch (e) {
        res.writeHead(409, 'Already Recording');
        res.write('Recording is already active', function() {
            res.end();
        });
    }
});

route('POST:/scenarios/finishRecording', function stopRecordingScenario(req, res, config) {
    try {
        var scriptOutputDir = undefined;
        if (config.scenarios.writeNewScenarios && config.scenarios.scenarioOutputDir) {
            scriptOutputDir = config.scenarios.scenarioOutputDir;
        }

        var scenario = $scenarioRecorder.finishRecordingScenario(scriptOutputDir);


        var parsedUrl = $url.parse(req.url, true);
        if (parsedUrl.query && parsedUrl.query['save'] == 'true') {
            console.log(scenario);
            config.playback.scenarioRecorder(scenario.player());
        }
        
        res.write(JSON.stringify(scenario), function() {
            res.end();
        });
    } catch (e) {
        res.writeHead(409, 'Finish Recording Failed');
        res.write(e.message, function() {
            res.end();
        });
    }
});