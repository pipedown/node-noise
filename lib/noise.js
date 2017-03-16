'use strict';

var addon = require('../native');
const net = require('net');

addon.startListener();

var connectionId = 0;

var newDb = function(socket, connId) {
    this.add = function(json) {
        return new Promise((resolve, reject) => {
            try {
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
            } catch(e) {
                reject(e);
                return;
            }
            var localCb = (_buffer) => {
                try {
                    // we must remove the listener or it keeps getting notifications
                    socket.removeListener('data', localCb);
                    // get the response. on an error it throws exception
                    var resp = addon.getResponse(connId);
                } catch(e) {
                    reject(e);
                    return;
                }
                resolve(resp);
            };
            // wait for the response
            socket.on('data', localCb);
        });
    };

    this.delete = function(ids) {
        return new Promise((resolve, reject) => {
            try {
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
            } catch(e) {
                reject(e);
                return;
            }
            var localCb = (_buffer) => {
                try {
                    // we must remove the listener or it keeps getting notifications
                    socket.removeListener('data', localCb);
                    var resp = addon.getResponse(connId);
                } catch(e) {
                    reject(e);
                    return;
                }
                resolve(resp);
            };
            socket.on('data', localCb);
        });
    };

    this.query = function(query) {
        return new Promise((resolve, reject) => {
            try {
                // call the native function and put data into the message slot
                addon.indexQuery(connId, query);
                //notify the waiting thread a message is waiting
                socket.write("0");
            } catch(e) {
                reject(e);
                return;
            }
            var localCb = (_buffer) => {
                try {
                    // we must remove the listener or it keeps getting notifications
                    socket.removeListener('data', localCb);
                    // get the response. It throws if there is an unexepected error.
                    var resp = addon.getResponse(connId);
                } catch(e) {
                    reject(e);
                    return;
                }
                resolve(resp);
            };
            socket.on('data', localCb);
        });
    };

    this.close = function() {
        return new Promise((resolve, reject) => {
            try {
                // call the native function and put message into the message slot
                addon.indexClose(connId);
                //notify the waiting thread a message is waiting
                socket.write("0");
            } catch(e) {
                reject(e);
                return;
            }
            // wait for the socket to close (that means the serving thread stopped)
            socket.on('end', () => {resolve()});
        });
    };
}

module.exports = {
    open: function(name) {
        if (arguments.length == 1) {
            var createIfMissing = false;
        } else if (arguments.length > 1) {
            var createIfMissing = arguments[1];
        }
        // the connectionId is used as a slot address for sending messages to the
        // serving thread
        var connId = (connectionId++).toString();

        // now create the promise for when the database opens
        return new Promise((resolve, reject) => {
            var socket = net.connect("echo.sock", () => {
                try {
                    // we've connected. Now send the connectionId so both sides
                    // know the common message slot.
                    socket.write(connId + ";");
                    // put the message in the slot
                    addon.openIndex(connId, name, createIfMissing);
                    //notify the thread we did it
                    socket.write("0");
                } catch(e) {
                    reject(e);
                    return;
                }
                var localCb = (_buffer) => {
                    try {
                        // remove this callback or we'll keep getting events to it
                        socket.removeListener('data', localCb);
                        // get_response will throw if error
                        var _ = addon.getResponse(connId);
                        var db = new newDb(socket, connId);
                    } catch(e) {
                        reject(e);
                        return;
                    }
                    resolve(db);
                };
                socket.on('data', localCb);
            });
        });
    },

    drop: function(name) {
        // the connectionId is used as a slot address for sending messages to the
        // serving thread
        var connId = (connectionId++).toString();

        // now create the promise for when the database deletes
        return new Promise((resolve, reject) => {
            var socket = net.connect("echo.sock", () => {
                try {
                    // we've connected. Now send the connectionId so both sides
                    // know the common message slot.
                    socket.write(connId + ";");
                    // put the message in the slot
                    addon.dropIndex(connId, name);
                    //notify the thread we did it
                    socket.write("0");
                } catch(e) {
                    reject(e);
                    return;
                }
                var localCb = (_buffer) => {
                    try {
                        // remove this callback or we'll keep getting events to it
                        socket.removeListener('data', localCb);
                        // get_response will throw if error
                        var resp = addon.getResponse(connId);
                        socket.end();
                    } catch(e) {
                        socket.end();
                        reject(e);
                        return;
                    }
                    resolve(resp);
                };
                socket.on('data', localCb);
            });
        });
    }
};
