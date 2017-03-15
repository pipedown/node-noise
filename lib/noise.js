'use strict';

var addon = require('../native');
const net = require('net');

addon.startListener();

var connectionId = 0;

var newDb = function(socket, connId) {
    this.add = function(json) {
        if (Array.isArray(json)) {
            // if passed an array of objects convert them to an array of strings
            var input = [];
            for (var i = 0; i < json.length; i++) {
                input.push(JSON.stringify(json[i]));
            }
        } else {
            // single object. convert to string and into array
            var input = [JSON.stringify(json)];
        }
        // call the native function and put data into the message slot
        addon.indexAdd(connId, input);
        //notify the waiting thread a message is waiting
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
                    // we must remove the listener or it keeps getting notifications
                    socket.removeListener('data', localCb);
                    try {
                        // get the response. on an error it throws exception
                        var resp = addon.getResponse(connId);
                        resolve(resp);
                    } catch(e) {
                        reject(e);
                    }
                };
                // wait for the response
                socket.on('data', localCb);
            }
        );
    };

    this.delete = function(ids) {
        if (Array.isArray(ids)) {
            // if passed an array of ids convert them to an array of strings
            var input = ids;
        } else {
            // convert to single id array
            var input = [ids];
        }
        // call the native function and put data into the message slot
        addon.indexDelete(connId, input);
        //notify the waiting thread a message is waiting
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
                    // we must remove the listener or it keeps getting notifications
                    socket.removeListener('data', localCb);
                    try {
                        var resp = addon.getResponse(connId);
                        resolve(resp);
                    } catch(e) {
                        reject(e);
                    }
                };
                socket.on('data', localCb);
            }
        );
    };

    this.query = function(query) {
        // call the native function and put data into the message slot
        addon.indexQuery(connId, query);
        //notify the waiting thread a message is waiting
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
                    // we must remove the listener or it keeps getting notifications
                    socket.removeListener('data', localCb);
                    try {
                        var resp = addon.getResponse(connId);
                        resolve(resp);
                    } catch(e) {
                        reject(e);
                    }
                };
                socket.on('data', localCb);
            }
        );
    };

    this.close = function() {
        // call the native function and put message into the message slot
        addon.indexClose(connId);
        //notify the waiting thread a message is waiting
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
                    resolve();
                };
                // wait for the socket to close
                socket.on('end', localCb);
            }
        );
    };
}

module.exports = {
    open: function(name) {
        if (arguments.length == 1) {
            var createIfMissing = false;
        } else if (arguments.length == 2) {
            var createIfMissing = arguments[1];
        }
        var connId = (connectionId++).toString();

        // now create the promise for when the database opens
        return new Promise((resolve, reject) => {
            var socket = net.connect(
                "echo.sock",
                () => {
                    // we've connected. Now send the connectionId so both sides
                    // know the common message slot.
                    socket.write(connId + ";");
                    // put the message in the slot
                    addon.openIndex(connId, name, createIfMissing);
                    //notify the thread we did it
                    socket.write("0");

                    var localCb = (_buffer) => {
                        // remove this callback or we'll keep getting events to it
                        socket.removeListener('data', localCb);
                        try {
                            // get_response will throw if error
                            var _ = addon.getResponse(connId);
                            var db = new newDb(socket, connId);
                            resolve(db);
                        } catch(e) {
                            reject(e);
                        }
                    };
                    socket.on('data', localCb);
                });
            }
        );
    },

    drop: function(name) {
        var connId = (connectionId++).toString();

        // now create the promise for when the database deletes
        return new Promise((resolve, reject) => {
            var socket = net.connect(
                "echo.sock",
                () => {
                    // we've connected. Now send the connectionId so both sides
                    // know the common message slot.
                    socket.write(connId + ";");
                    // put the message in the slot
                    addon.dropIndex(connId, name);
                    //notify the thread we did it
                    socket.write("0");

                    var localCb = (_buffer) => {
                        // remove this callback or we'll keep getting events to it
                        socket.removeListener('data', localCb);
                        try {
                            // get_response will throw if error
                            var resp = addon.getResponse(connId);
                            socket.end();
                            resolve(resp);
                        } catch(e) {
                            socket.end();
                            reject(e);
                        }
                    };
                    socket.on('data', localCb);
                });
            }
        );
    }
};
