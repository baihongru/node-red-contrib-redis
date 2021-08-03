module.exports = function(RED) {
    "use strict";
    // require package
    var util = require("util");
    var redis = require('redis');
    var uuid = require('uuid');
    var mustache = require("mustache");

    // connection config definition
    function RedisConfig(n) {
        RED.nodes.createNode(this, n);
        this.host = n.host;
        this.port = n.port;
        this.dbase = n.dbase;
        this.pass = n.pass;
    };
    RED.nodes.registerType("contrib-redis-config", RedisConfig);

    // parse connection configuration
    function parseConnConf(config) {
        var result = [];
        for (var key in config) {
            if (/{{/.test(config[key])){
                //result[key] = mustache.render(config[key], process.env);
                result[key] = "";
            } else {
                result[key] = config[key];
            }
        }
        return result;
    };

    // redis connection pool definition
    var redisConnectionPool = function() {
        var connections = {};
        var obj = {
            get: function(server, uuid1) {
                var connConf = parseConnConf(server);
                var host = connConf.host;
                var port = connConf.port;
                var options = {};
                if(connConf.pass !== ""){
                    options['password'] = connConf.pass;
                };
                if(connConf.dbase !== ""){
                    options['db'] = connConf.dbase;
                };

                var id = host + ":" + port + ":" + uuid1;
                if (!connections[id]) {
                    connections[id] = redis.createClient(port, host, options);
                    connections[id].on("error", function(err) {
                            util.log("[redis] " + err);
                    });
                    connections[id].on("connect", function() {
                            util.log("[redis] connected to " + host + ":" + port);
                    });
                    connections[id]._id = id;
                    connections[id]._nodeCount = 0;
                }
                connections[id]._nodeCount += 1;
                return connections[id];
            },
            close: function(connection) {
                connection._nodeCount -= 1;
                if (connection._nodeCount === 0) {
                    if (connection) {
                        clearTimeout(connection.retry_timer);
                        //connection.end(flush);
                        connection.quit();
                    }
                    delete connections[connection._id];
                }
            }
        };
        return obj;
    }();

    // redis-sub node definition
    function redisSub(config) {
        // Create a RED node
        RED.nodes.createNode(this,config);

        // Store local copies of the node configuration (as defined in the .html)
        this.server = RED.nodes.getNode(config.server);
        this.name = config.name;
        this.channel = config.channel;

        var uuid1 = uuid.v4();
        //Create redis Client connection
        this.client = redisConnectionPool.get(this.server, uuid1);

        var node = this;
        
        if (node.client.connected) {
            node.status({fill: "green", shape: "dot", text: "connected"});
        } else {
            node.status({fill: "red", shape: "ring", text: "disconnected"}, true);
        }

        node.client.on("end", function() {
            node.status({fill: "red", shape: "ring", text: "disconnected"});
        });
        node.client.on("connect", function() {
            node.status({fill: "green", shape: "dot", text: "connected"});
        });

        node.client.subscribe(node.channel);
        
        //node.client.on("subscribe", function (channel, count) {
        //   this.status({fill:"blue",shape:"dot",text:count});
        //});

        node.client.on("message", function (channel, message) {
            // send out the message to the rest of the workspace.
            var payload = null;
            try {
                payload = JSON.parse(message);
            } catch (err) {
                payload = message;
            } finally {
                node.send({
                    //channel: channel,
                    payload: payload
                });
            };
        });

        node.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: this.client.disconnect();
            redisConnectionPool.close(node.client);
        });
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("redis-sub",redisSub);

    // redis-pub node definition
    function redisPub(config) {
        // Create a RED node
        RED.nodes.createNode(this,config);

        // Store local copies of the node configuration (as defined in the .html)
        this.server = RED.nodes.getNode(config.server);
        this.name = config.name;
        this.channel = config.channel;

        var uuid1 = uuid.v4();
        //Create redis Client connection
        this.client = redisConnectionPool.get(this.server, uuid1);

        var node = this;
        
        if (node.client.connected) {
            node.status({fill: "green", shape: "dot", text: "connected"});
        } else {
            node.status({fill: "red", shape: "ring", text: "disconnected"}, true);
        }

        node.client.on("end", function() {
            node.status({fill: "red", shape: "ring", text: "disconnected"});
        });
        node.client.on("connect", function() {
            node.status({fill: "green", shape: "dot", text: "connected"});
        });

        node.on('input', function(msg) {
            // do something with 'msg'
            try {
                node.client.publish(node.channel, JSON.stringify(msg.payload));
            } catch (err) {
                node.error(err);
            };
        });

        node.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: this.client.disconnect();
            redisConnectionPool.close(node.client);
        });
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("redis-pub",redisPub);

    // redis-hash node definition
    function redisHash(config) {
        // Create a RED node
        RED.nodes.createNode(this,config);

        // Store local copies of the node configuration (as defined in the .html)
        this.server = RED.nodes.getNode(config.server);
        this.name = config.name;
        this.hash = config.hash;
        this.key = config.key;
        this.postfix = config.postfix || "Name";

        var uuid1 = uuid.v4();
        //Create redis Client connection
        this.client = redisConnectionPool.get(this.server, uuid1);
        this.client.setMaxListeners(0);

        var node = this;
        
        if (node.client.connected) {
            node.status({fill: "green", shape: "dot", text: "connected"});
        } else {
            node.status({fill: "red", shape: "ring", text: "disconnected"}, true);
        }

        node.client.on("end", function() {
            node.status({fill: "red", shape: "ring", text: "disconnected"});
        });
        node.client.on("connect", function() {
            node.status({fill: "green", shape: "dot", text: "connected"});
        });

        node.on('input', function(msg) {
            // do something with 'msg'
            var descKey = node.key + node.postfix;
            if (msg.payload[node.key] !== undefined) {
                node.client.hget(node.hash, msg.payload[node.key], function(err, reply) {
                    if(err) {
                        msg.payload[descKey] = err;
                    } else {
                	    msg.payload[descKey] = reply;
                    };
                    node.send(msg);
                });
            } else {
                node.send(msg);
            };
        });

        node.on("close", function() {
            // Called when the node is shutdown - eg on redeploy.
            // Allows ports to be closed, connections dropped etc.
            // eg: this.client.disconnect();
            redisConnectionPool.close(node.client);
        });
    }

    // Register the node by name. This must be called before overriding any of the
    // Node functions.
    RED.nodes.registerType("redis-hash",redisHash);

};
