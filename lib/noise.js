'use strict';

var addon = require('../native');
const net = require('net');

addon.startListener();

var connectionId = 0;

var newDb = function(socket, connId) {
    this.add = function(json) {
        if (Array.isArray(json)) {
            var input = [];
            for (var i = 0; i < json.length; i++) {
                input.push(JSON.stringify(json[i]));
            }
        } else {
            var input = [JSON.stringify(json)];
        }
        addon.indexAdd(connId, input);
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
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

    this.delete = function(ids) {
        if (Array.isArray(ids)) {
            var input = [];
            for (var i = 0; i < ids.length; i++) {
                input.push(ids[i]);
            }
        } else {
            var input = [ids];
        }
        addon.indexDelete(connId, input);
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
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
        addon.indexQuery(connId, query);
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
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
        addon.indexClose(connId);
        socket.write("0");
        return new Promise(
            (resolve, reject) => {
                var localCb = (_buffer) => {
                    resolve();
                };
                socket.on('end', localCb);
            }
        );
    };
}

module.exports = {
    open: function(name) {
        if (arguments.length == 2) {
            var createIfMissing = false;
        } else if (arguments.length == 3) {
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
                        console.log("got data");
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
                socket_name,
                () => {
                    // we've connected. Now send the connectionId so both sides
                    // know the common message slot.
                    socket.write(connId + ";");
                    // put the message in the slot
                    addon.dropIndex(connId, name);
                    //notify the thread we did it
                    socket.write("0");

                    var localCb = (_buffer) => {
                        console.log("got data");
                        // remove this callback or we'll keep getting events to it
                        socket.removeListener('data', localCb);
                        try {
                            // get_response will throw if error
                            var resp = addon.getResponse(connId);
                            socket.end();
                            resolve(resp);
                        } catch(e) {
                            reject(e);
                        }
                    };
                    socket.on('data', localCb);
                });
            }
        );
    }
};
