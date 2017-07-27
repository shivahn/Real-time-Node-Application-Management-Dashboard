var appConfigData = require('../appConfig/appConfigData').data;
var ioClient = require('socket.io-client');
var ioClientSocket = {};
var hosts = appConfigData.serviceServerInfo;

module.exports = function(socket) {
		for (var key in hosts) {
			(function (key){
				
				ioClientSocket[hosts[key].host] = ioClient.connect(hosts[key].url, {reconnect: true, transports: ['websocket']} );
			
				ioClientSocket[hosts[key].host].on('connect', function() {
					ioClientSocket[hosts[key].host].emit('authorization',socket.namespace.userId,function(data){
						socket.emit('authorization', data);
						socket.disconnect();
					});
				});
			
				ioClientSocket[hosts[key].host].on('error', function () {
					
				});
				
				ioClientSocket[hosts[key].host].on('message',function(data) {
					socket.emit('message', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('message:board',function(data) {
					socket.emit('message:board', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('log:pm2',function(data) {
					socket.emit('log:pm2', {data: data});
				});
								
				ioClientSocket[hosts[key].host].on('log:out',function(data) {
					socket.emit('log:out', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('log:error',function(data) {
					socket.emit('log:error', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('log:realtime',function(data) {
					socket.emit('log:realtime', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('operation:status', function(data) {
					socket.emit('operation:status', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('cache',function(data) {
					socket.emit('cache', {data: data});
				});
				
				ioClientSocket[hosts[key].host].on('notify', function(data) {
					socket.emit('notify', {data: data});
				});

				ioClientSocket[hosts[key].host].on('reconnect_failed', function() {
					
				});
				
			})(key)
		}
		
		socket.on('operation', function(data) {
			ioClientSocket[data.host].emit('operation', data);
		});
		
};
