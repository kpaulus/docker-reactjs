(function(){
    /// private
    var UTILS = {
        arrayFindIndex: function(array, cb, target) {
            for(var i = 0; i < array.length; i++){
                if(cb.call(target, array[i], i, array))
                   return i; 
            }
            return -1;
        },
        arrayFind: function(array, cb, target) {
            for(var i = 0; i < array.length; i++){
                if(cb.call(target, array[i], i, array))
                   return array[i]; 
            }
            return null;
        }
    };

    /// The message structure sent to listeners
    function Message(type, subType, src, msg) {
        this.type = type;
        this.subType = subType;
        this.source = src;
        this.message = msg;
    }
    Message.read = function(raw) {
        var parsed = JSON.parse(raw);
        return new Message(parsed.type, parsed.subType, parsed.source, parsed.message);
    };

    /// private
    function Listener(fn, target) {
        this.fn = fn;
        this.target = target;
    }
    Listener.prototype.invoke = function(msg) {
        this.fn.call(this.target, msg); 
    };
    Listener.prototype.equals = function(other){
        return this.fn === other.fn && this.target === other.target;
    };

    ///
    // Basic client side chat service. Handles connection and message logic.
    //
    // ctor argument "targetHost" specifies the hostname of the connection to make
    //
    // call "connect" with your chat name.
    //
    // messages recieved from the server have 4 properties: 
    // { 
    //      type: <string>, 
    //      subType: <string>, 
    //      source: <string>, 
    //      message: <string> 
    // }
    //
    // Examples below are formatted like so:
    // (type, subType, source, message)
    //
    // SERVER messages include:
    // (SERVER, LOGON, name, "true"/"false") - specifies login attempt result
    // (SERVER, ERROR, null, errMsg) - specifies the server had an error
    // (SERVER, CLOSE, null, null) - specifies the connection to the server closed
    //
    // CHANNEL messages include:
    // (CHANNEL, CLIENT JOIN, channelName, clientName) - event when another client joins a channel
    // (CHANNEL, JOINED, channelName, null) - event when you have joined the specified channel   
    // (CHANNEL, CLIENT LEAVE, channelName, clientName) - event when another client leaves the channel
    // (CHANNEL, LIST, channelName, <serialized json array of strings>) - event response, listing the other clients in the channel
    //
    // CHAT messages include:
    // (CHAT, ALL, clientName, messageText) - event when another user sends a message
    // (CHAT, ME, clientName, emoteText) - event when another user "emotes"
    // (CHAT, WHISPER, clientName, messageText) - event when another user "whispers" you
    //
    // LOCAL messages include:
    // (LOCAL, ERROR, null, errMsg) - event when the local service encounters an error
    //
    function ChatClientService(targetHost, targetPort){
        this._host = targetHost; 
        this._port = targetPort;
        this._listeners = [];
        this._ws = null;
        this._name = null;
    }
    /// connects to the remote server (specified by ctor's arg [targetHost]), using
    /// the given [loginName]. Once connected, a (SERVER, LOGON, [targetHost], "true"), will be sent
    /// to all listeners. If the LOGON message returns "false", another user on 
    /// the server already has that username, and you will need to close and reconnect
    /// with a different name
    ///
    /// NOTE: be sure to add a listener before connecting.
    ///
    ChatClientService.prototype.connect = function(loginName) {
        this.close();
        this._name = loginName;
        this._ws = new WebSocket("ws://" + this._host + ":" + this._port);
        this._ws.onopen = ChatClientService.prototype._onOpen.bind(this);
        this._ws.onmessage = ChatClientService.prototype._onMessage.bind(this);
        this._ws.onclose = ChatClientService.prototype._onClose.bind(this);
    };
    ///Loses the connection. No message is sent to Listeners
    ChatClientService.prototype.close = function(){
        if(this._ws) this._ws.close();
        this._ws = null; 
    };
    ///Adds a listener. [fn] is the function to be called with any message,
    ///[target] is the optional argument on which the function will be called.
    ChatClientService.prototype.addListener = function(fn, target) {
        var l = new Listener(fn, target);
        if(UTILS.arrayFindIndex(this._listeners, function(v, i, a){ return v.equals(l); }, null) === -1){
            this._listeners.push(l);
        } 
    };
    /// Finds a matching [fn] and [target] listener in the listening list
    /// and removes it, preventing future events from being invoked on that listener
    ChatClientService.prototype.removeListener = function(fn, target) {
        var l = new Listener(fn, target);
        var idx = UTILS.arrayFindIndex(this._listeners, function(v, i, a){ return v.equals(l); }, null);
        if(idx !== -1){
            this._listeners.splice(idx, 1);
        }
    };
    /// Clears all listeners from this service
    ChatClientService.prototype.removeAllListeners = function(){
        this._listeners = [];
    };

    /// Sends a message to the server.  The raw string message the user entered
    /// should be given here. The message will automatically be parsed for COMMANDS
    /// and the appropriate message will be sent to the server.
    ///
    /// Available commands - note commands start with '/'
    /// /join <channel> -> switches the connected user to a different channel
    /// /me | /emote <text> -> sends an "emote" command to the server. for example
    ///                        if my user name  is "Foo" and I type "/me eats cake",
    ///                        other users should see the emote "Foo eats cake"
    /// /w | /whisper <username> <text> -> sends a private message to the user
    /// /ls | /list -> lists all users in the current channel
    ///
    /// any other message starting with "/" will result in a (LOCAL, ERROR, null, msg)
    /// any other message will send a regular channel chat message to the server
    ///
    ChatClientService.prototype.sendMessage = function(messageText) {
        var splits, cmd, name, msg;
        if(messageText.indexOf("/") === 0){
            if(messageText.indexOf("/join ") === 0) {
                splits = messageText.split(' ');
                cmd = splits[0];
                name = splits[1];
                if(typeof name !== "string" || name.length === 0) 
                    this._sendAll(new Message("LOCAL", "ERROR", null, "Invalid channel name"));

                this._ws.send(JSON.stringify(new Message("COMMAND", "JOIN", null, name))); 
            } else if(messageText.indexOf("/me ") === 0 || messageText.indexOf("/emote ") === 0){
                splits = messageText.split(' ');
                splits.shift();
                msg = splits.join(' ');
                this._ws.send(JSON.stringify(new Message("COMMAND", "EMOTE", this._name, msg))); 
            } else if(messageText.indexOf("/w ") === 0 || messageText.indexOf("/whisper ") === 0) {
                splits = messageText.split(' ');
                splits.shift();
                name = splits.shift();
                msg = splits.join(' ');
                this._ws.send(JSON.stringify(new Message("CHAT", "W", name, msg))); 
            } else if(messageText.indexOf("/ls") === 0 || messageText.indexOf("/list") === 0) {
                this._ws.send(JSON.stringify(new Message("COMMAND", "LIST", null, null))); 
            } else {
                this._sendAll(new Message("LOCAL", "ERROR", null, "Unknown command: \"" + messageText + "\""));
            }
        } else {
            this._ws.send(JSON.stringify(new Message("CHAT", "ALL", this._name, messageText))); 
        }
    };

    /// private
    ChatClientService.prototype._onOpen = function(msg) {
        this._ws.send(JSON.stringify(new Message("COMMAND", "LOGON", this._name, null))); 
    };
    /// private
    ChatClientService.prototype._onMessage = function(msg) {
        var message = Message.read(msg.data);
        this._sendAll(message);
    };
    /// private
    ChatClientService.prototype._onClose = function(msg) {
        var message = new Message("SERVER", "CLOSE");
        this._sendAll(message);
    };
    /// private
    ChatClientService.prototype._sendAll = function(msg){
        this._listeners.slice().forEach(function(v){ v.invoke(msg); });
    };

    window.ChatClientService = ChatClientService;
})();
