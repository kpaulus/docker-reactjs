(function(){

    Array.prototype.remove = function(target){
        var idx = this.indexOf(target);
        if(idx != -1){
            this.splice(idx, 1);
            return true;
        }
        return false;
    };
    Array.prototype.find = function(cb, target) {
        for(var i = 0; i < this.length; i++){
            if(cb.call(target, this[i], i, this)) return this[i];
        }
        return null;
    };
    
    var ws = require("ws");
    var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

    function Message(type, subType, src, msg){
        this.type = type;
        this.subType = subType;
        this.source = src;
        this.message = msg;
    }
    Message.read = function(raw){
        var parsed = JSON.parse(raw);
        return new Message(parsed.type, parsed.subType, parsed.source, parsed.message);
    };

    function ChatClient(wsClient, server){
        this.wsClient = wsClient;
        this.server = server;
        this.name = null;
        this.channel = null;
        this.timer = null;

        this.wsClient.on('message', ChatClient.prototype.onMessage.bind(this));
        this.wsClient.on('close', ChatClient.prototype.onClose.bind(this));
        this.timer = setTimeout(ChatClient.prototype.timeout.bind(this), 2000);
    }
    ChatClient.prototype.sendMessage = function(message){
        this.wsClient.send(JSON.stringify(message));
    };
    ChatClient.prototype.setChannel = function(channel){
        this.channel = channel;
    };
    ChatClient.prototype.joinChannel = function(name){
        if(!this.server.switchRoom(name, this)){
            this.sendMessage(new Message("SERVER", "ERROR", null, "Cannot join channel: " + name));
        }
    };
    ChatClient.prototype.timeout = function() {
        this.onClose(null);
    };
    ChatClient.prototype.onMessage = function(message) {
        console.log(message);
        var msg = Message.read(message);
        if(msg.type === "COMMAND"){
            if(msg.subType === "LOGON") {
                this.name = msg.source;
                if(this.server.logon(this, this.name)){
                    if(this.timer !== null){
                        clearTimeout(this.timer);
                        this.timer = null;
                    }
                }
            }
            if(msg.subType === "JOIN") {
                this.server.switchRoom(msg.message, this);
            }
            if(msg.subType === "ME" || msg.subType === "EMOTE") {
                if(this.channel) this.channel.broadcast(new Message("CHAT", "ME", this.name, msg.message));
            }
            if(msg.subType === "W" || msg.subType === "WHISPER") {
                this.server.whisper(msg.source, this.name, msg.message);
            }
            if(msg.subType === "LS" || msg.subType === "LIST"){
                if(this.channel) {
                    var clientNames = this.channel.requestClients();
                    this.sendMessage(new Message("CHANNEL", "LIST", this.channel.name, JSON.stringify(clientNames)));
                }
            }
        } else if(msg.type === "CHAT") {
            if(this.channel) this.channel.broadcast(new Message("CHAT", "ALL", this.name, msg.message));
        }

    };
    ChatClient.prototype.onClose = function(status){
        if(this.channel) this.channel.removeClient(this);
        this.server.logout(this);
    };

    function ChatServer(wsServer){
        this.wsServer = wsServer;
        this.general = new ChatRoom(this, "General");
        this.rooms = { "General": this.general };
        this.clients = [];
        this.limbo = [];
    }
    ChatServer.prototype.start = function(){
        this.wsServer.on('connection', ChatServer.prototype.onConnection.bind(this));
    };
    ChatServer.prototype.logon = function(client, name) {
        var test = this.clients.find(function(c) { return c.name === name; });
        if(!test){
            this.clients.push(client);
            client.sendMessage(new Message("SERVER", "LOGON", name, "true"));
            this.general.addClient(client);
            return true;
        }
        client.sendMessage(new Message("SERVER", "LOGON", name, "false"));
        return false;
    };
    ChatServer.prototype.logout = function(client) {
        var col = this.clients;
        var idx = col.indexOf(client);
        if(idx === -1){
            col = this.limbo;
            idx = col.indexOf(client);
        }

        if(idx !== -1){
            col.splice(idx, 1);
        }

    };
    ChatServer.prototype.switchRoom = function(name, client){
        var room = this.rooms[name];
        if(typeof room === "undefined"){
            room = new ChatRoom(this, name);
            this.rooms[name] = room;
        }
        if(client.channel !== null)
            client.channel.removeClient(client);
        room.addClient(client);
    };
    ChatServer.prototype.destroyRoom = function(chatRoom) {
        if(chatRoom !== this.general)
            delete this.rooms[chatRoom.name];
    };
    ChatServer.prototype.whisper = function(target, src, message) {
        var client = this.clients.find(function(c) { return c.name === target; });
        if(client) {
            client.sendMessage(new Message("CHAT", "WHISPER", src, message)); 
            return true;
        }
        return false;
    };
    ChatServer.prototype.onConnection = function(ws) {
        this.limbo.push(new ChatClient(ws, this));
    };

    function ChatRoom(server, name){
        this.chatServer = server;
        this.name = name;
        this.clients = [];
    }

    function return_catfact() {        
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "http://catfacts-api.appspot.com/api/facts", false);
        xhr.send();
        return JSON.parse(xhr.responseText).facts[0];
    }

    ChatRoom.prototype.addClient = function(chatClient){
        if(this.clients.indexOf(chatClient) === -1){
            this.broadcast(new Message("CHANNEL", "CLIENT JOIN", this.name, chatClient.name));
            this.clients.push(chatClient);
            chatClient.setChannel(this);
            chatClient.sendMessage(new Message("CHANNEL", "JOINED", this.name, "Welcome " + chatClient.name));
            // Cat Facts Bot
            fact = return_catfact();
            chatClient.sendMessage(new Message("CHAT", "ALL", "Cat Facts", chatClient.name + ", did you know..." + fact));
            return true;
        } else {
            return false;  
        }
    };
    ChatRoom.prototype.broadcast = function(message){
        this.clients.forEach(function(c){ c.sendMessage(message); });
    };
    ChatRoom.prototype.removeClient = function(chatClient){
        chatClient.sendMessage(new Message("CHAT", "ALL", "Cat Facts", "Goodbye for meow "+ chatClient.name));
        var removed = this.clients.remove(chatClient);
        if(removed){
            if(this.clients.length === 0){
                this.chatServer.destroyRoom(this);
            } else {
                this.broadcast(new Message("CHANNEL", "CLIENT LEAVE", this.name, chatClient.name));
            }
        }
        return removed;
    };
    ChatRoom.prototype.requestClients = function(){
        return this.clients.map(function(c){ return c.name; });
    };

    var wss = new ws.Server({ port: 8081 });
    new ChatServer(wss).start();
})();
