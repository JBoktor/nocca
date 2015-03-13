'use strict';

var $zlib = require('zlib');
var $q = require('q');
var $http = require('http');
var $https = require('https');

var $utils = require('./utils');

module.exports = httpMessageFactory;

function httpMessageFactory (Nocca) {

    var constants = {
        REQUEST: 'REQUEST',
        RESPONSE: 'RESPONSE'
    };

    var exportProperties = {};
    exportProperties[constants.REQUEST] = {
        type: 'type',
        method: 'method',
        host: 'host',
        port: 'port',
        path: 'path',
        headers: 'headers',
        body: 'bodies.readable'
    };
    exportProperties[constants.RESPONSE] = {
        type: 'type',
        statusCode: 'statusCode',
        statusMessage: 'statusMessage',
        headers: 'headers',
        body: 'bodies.readable'
    };

    this.createRequest = createRequest;
    this.createResponse = createResponse;

    function createRequest () {
        return new HttpMessage(constants.REQUEST);
    }
    function createResponse () {
        return new HttpMessage(constants.RESPONSE);
    }

    function extractProperties (properties, subject, filterFn) {

        function extractNestedProperty (propertyString, subject) {

            var objValue = subject;
            var properties = propertyString.split('.');

            properties.forEach(function (property) {
                // cannot break a foreach, so if-statement
                if (typeof objValue !== 'undefined') {
                    objValue = objValue[property];
                }
            });

            return objValue;

        }


        var obj = {};

        Object.keys(properties).forEach(function (property) {

            var value = properties[property];

            // resolve objValue
            var objValue = undefined;

            if (value.indexOf('.') > -1) {

                objValue = extractNestedProperty(value, subject);

            }
            else {
                objValue = subject[value];
            }


            if (!filterFn || filterFn(objValue)) {
                obj[property] = objValue;
            }

        });

        return obj;

    }

    HttpMessage.prototype.getBody = getBody;
    HttpMessage.prototype.setBody = setBody;
    HttpMessage.prototype.pack = pack;
    HttpMessage.prototype.unpack = unpack;
    HttpMessage.prototype.readIncomingMessage = readIncomingMessage;
    HttpMessage.prototype.sendAsRequest = sendAsRequest;
    HttpMessage.prototype.sendAsResponse = sendAsResponse;
    HttpMessage.prototype._determineContentEncoding = _determineContentEncoding;
    HttpMessage.prototype.dump = dump;

    function HttpMessage (type) {

        // request or response
        this.type = type;

        // request params, used as request from Nocca to outside
        this.method = undefined;
        this.host = undefined;
        this.port = undefined;
        this.path = undefined;

        // response params, used as response from Nocca to client
        this.statusCode = undefined;
        this.statusMessage = undefined;

        // shared params
        this.headers = undefined;

        this.body = undefined;

        this.bodies = {
            raw: undefined,
            buffer: undefined,
            readable: undefined
        };

        this._contentEncoding = undefined;
        this._packer = undefined;
        this._unpacker = undefined;

    }


    function _determineContentEncoding () {

        this._contentEncoding = this.headers['content-encoding'] ? this.headers['content-encoding'].toString() : false;

        switch (this._contentEncoding) {
            case 'gzip':
                this._packer = $zlib.gzip;
                this._unpacker = $zlib.gunzip;
                break;
            case 'deflate':
                this._packer = $zlib.deflate;
                this._unpacker = $zlib.inflate;
                break;
        }

        return this._contentEncoding;

    }

    function getBody (type) {

        type = type || 'readable';
        return this.bodies[type];

    }

    function setBody (body, type) {

        type = type || 'readable';
        this.bodies[type] = body;

        return this.bodies[type];

    }

    function pack () {

        var self = this;

        var deferred = $q.defer();

        self._determineContentEncoding();

        if (self._packer) {
            // make sure there's a buffer body waiting for us
            if (self.getBody() && !self.getBody('buffer')) {
                self.setBody(new Buffer(self.getBody()), 'buffer');
            }
            self._packer(self.getBody('buffer'), function (err, resultBuffer) {
                if (err) {
                    deferred.reject(err);
                }
                else {
                    deferred.resolve(self.setBody(resultBuffer, 'buffer'));
                }
            });
        }
        else {
            deferred.resolve(self.setBody(new Buffer(self.getBody()), 'buffer'));
        }

        return deferred.promise;

    }

    function unpack () {

        var self = this;

        var deferred = $q.defer();

        self._determineContentEncoding();

        if (self._unpacker) {
            self._unpacker(self.getBody('raw'), function (err, resultBuffer) {
                if (err) {
                    deferred.reject(err);
                }
                else {
                    self.setBody(resultBuffer, 'buffer');
                    self.setBody(resultBuffer.toString());
                    deferred.resolve(self.getBody());
                }
            });
        }
        else {
            self.setBody(self.getBody('raw'), 'buffer');
            self.setBody(self.getBody('buffer').toString());
            deferred.resolve(self.getBody());
        }

        return deferred.promise;

    }

    function readIncomingMessage (req) {

        var self = this;

        self.path = req.url;
        self.method = req.method;
        self.headers = req.headers;
        self.statusCode = req.statusCode;
        self.statusMessage = req.statusMessage;

        Nocca.logDebug('reading incoming body');
        return $utils.readBody(req)
            .then(function (bodyBuffer) {
                self.setBody(bodyBuffer, 'raw');
                Nocca.logDebug('incoming body read');

            });

    }

    function sendAsRequest () {

        var self = this;
        var fields = {
            host: 'host',
            hostname: 'hostname',
            port: 'port',
            method: 'method',
            path: 'path',
            headers: 'headers',
            auth:'auth'
        };

        var requestObj = extractProperties(fields, this, function (value) {
            return typeof value !== 'undefined';
        });

        var request = (self.protocol === 'https' ? $https : $http).request;

        request = request(requestObj);
        request.end(self.getBody());

        return request;

    }

    function sendAsResponse (res) {

        var self = this;

        // perform encoding tricks if required
        return self.pack()
            .then(function () {

                // fix content-length
                // node always uses lowercase headers, so this lowercase check will suffice
                if (self.headers.hasOwnProperty('content-length')) {

                    var bodyLength = self.getBody('buffer').length;
                    var contentLength = parseInt(self.headers['content-length']);

                    if (bodyLength !== contentLength) {
                        Nocca.logDebug('Content-Length header mismatches actual body size, adjusting header');
                        self.headers['content-length'] = bodyLength;
                    }

                }

                // write the head
                res.writeHead(self.statusCode, self.headers || {});

                // and write the rest
                res.end(self.getBody('buffer'));

            });

    }

    function dump () {

        return extractProperties(exportProperties[this.type], this);

    }


}

