'use strict';

var addon = require('../native');
const net = require('net');
var async = require('async');


addon.startListener();

var connectionId = 0;

var newDb = function(q, socket, connId) {
    var openError = null;
    var sendAndReceive = (callback, resolve, reject, msgType, argsFun) => {
        try {
            // If the index couldn't be opened propogate the error.
            if (openError) {
                throw openError;
            }
            var args = argsFun();
            // call the native function and put data into the message slot
            addon.sendMessage(connId, msgType, args);
            //notify the waiting thread a message is waiting
            socket.write("0");
        } catch(e) {
            try {
                reject(e);
            } finally {
                callback(e);
            }
            return;
        }
        var localCb = (_buffer) => {
            try {
                // we must remove the listener or it keeps getting notifications
                socket.removeListener('data', localCb);
                // get the response. on an error it throws exception
                var resp = addon.getResponse(connId);
            } catch(e) {
                try {
                    reject(e);
                } finally {
                    callback(e);
                }
                return;
            }
            try {
                resolve(resp);
            } finally {
                callback();
            }
        };
        // wait for the response
        socket.on('data', localCb);
    }
    this.add = function(json) {
        return new Promise((resolve, reject) => {
            q.push((callback) => {
                sendAndReceive(callback, resolve, reject, 2, () => {
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
                    return input;
                });
            });
        });
    };

    this.delete = function(ids) {
        return new Promise((resolve, reject) => {
            q.push((callback) => {
                sendAndReceive(callback, resolve, reject, 3, () => {
                    if (Array.isArray(ids)) {
                        // if passed an array of ids convert them to an array of strings
                        var input = ids;
                    } else {
                        // convert to single id array
                        var input = [ids];
                    }
                    return input;
                });
            });
        });
    };

    this.query = function(query) {
        return new Promise((resolve, reject) => {
            q.push((callback) => {
                try {
                    // If the index couldn't be opened propogate the error.
                    if (openError) {
                        throw openError;
                    }
                    // call the native function and put data into the message slot
                    addon.sendMessage(connId, 4, [query]);
                    //notify the waiting thread a message is waiting
                    socket.write("0");
                } catch(e) {
                    try {
                        reject(e);
                    } finally {
                        callback(e);
                    }
                    return;
                }
                var localCb = (_buffer) => {
                    try {
                        // we must remove the listener or it keeps getting notifications
                        socket.removeListener('data', localCb);
                        addon.getError(connId);
                    } catch(e) {
                        try {
                            reject(e);
                        } finally {
                            callback(e);
                        }
                        return;
                    }
                    var iter = {
                        next: () => {
                            var resp = addon.queryNext(connId);
                            if (resp.done) {
                                callback();
                            }
                            return resp;
                        },
                        unref: () => {
                            addon.queryUnref(connId);
                            callback();
                        }
                    }
                    resolve(iter);
                };
                // wait for the response
                socket.on('data', localCb);
            });
        });
    };

    this.close = function() {
        return new Promise((resolve, reject) => {
            q.push((callback) => {
                try {
                    // If the index couldn't be opened we are done
                    if (openError) {
                        try {
                            resolve();
                        } finally {
                            callback();
                        }
                        return;
                    }
                    // call the native function and put message into the message slot
                    addon.sendMessage(connId, 5, []);
                    //notify the waiting thread a message is waiting
                    socket.write("0");
                } catch(e) {
                    try {
                        reject(e);
                    } finally {
                        callback(e);
                    }
                    return;
                }
                // wait for the socket to close (that means the serving thread stopped)
                socket.on('end', () => {
                    try {
                        resolve();
                    } finally {
                        callback();
                    }
                });
            });
        });
    };
    // now push the open async handler into the queue.
    q.push((callback) => {
        var localCb = (_buffer) => {
            try {
                // remove this callback or we'll keep getting events to it
                socket.removeListener('data', localCb);
                // get_response will throw if error
                var _ = addon.getResponse(connId);
            } catch(e) {
                openError = e;
                callback(e);
                return;
            }
            callback();
        };
        socket.on('data', localCb);
    });
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
        var connId = (connectionId++);

        var socket = net.connect("echo.sock", () => {
            // we've connected. Now send the connectionId so both sides
            // know the common message slot.
            socket.write(connId.toString() + ";");
            // put the message in the slot
            addon.sendMessage(connId, 0, [name, createIfMissing]);
            //notify the thread we did it
            socket.write("0");
        });
        // we create a queue of async commands. The first command we'll use it
        // is open. Then any subsequent commands will run after complete
        // and produce an error if the database couldn't be opened or deleted.

        var q = async.queue((task, callback) => {
            task(callback);
        }, 1);
        var db = new newDb(q, socket, connId);
        return db;
    },

    drop: function(name) {
        // the connectionId is used as a slot address for sending messages to the
        // serving thread
        var connId = (connectionId++);

        // now create the promise for when the database deletes
        return new Promise((resolve, reject) => {
            var socket = net.connect("echo.sock", () => {
                try {
                    // we've connected. Now send the connectionId so both sides
                    // know the common message slot.
                    socket.write(connId.toString() + ";");
                    // put the message in the slot
                    addon.sendMessage(connId, 1, [name]);
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
