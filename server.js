"use strict";
const express = require('express');
const router = express.Router();
const path = require('path');
const http = require('http');
const pm2 = require('pm2');
const os = require('os');
const fs = require('fs');
const async = require("async");
const cpu = require('windows-cpu');
const execFile = require('child_process').execFile;
const backwardsStream  = require('fs-backwards-stream');
const nodeCache = require( "node-cache" );
const portscanner = require('portscanner');

const app = express();
const server = http.createServer(app);
const io = require('socket.io').listen(server);
const cache = new nodeCache();

var appConfigData = require('./config/appConfig').data;
var helperUtil = require('./helper/validateAdminAccess').util;
var sendNotification =  require('./helper/sendNotification');

var notifyMsg = [],asyncTasks = [], accessedUsers = [], appState = {}, timer, cpuMemTimer, cpuLoadTimer;
var hostName = os.hostname().toLowerCase();
var eNotify = appConfigData.notification.notify;
var eNotifychkd = appConfigData.notification.operations;

server.listen(appConfigData.hostServer.port);

app.use(function (req, res, next) {
	res.send('The server is up and running...');
});

function getServerStats(callback) {
	try {
			var stat = {
					errMsg: '',
					system_info:{
						hostname:hostName,
						uptime:os.uptime()
					},
					monit:{
						total_mem:os.totalmem(),
						free_mem:os.freemem(),
						cpuLoad: 0,
						cpu:os.cpus(),
						interfaces:os.networkInterfaces(),
						nodeCnt: 0,
						nodeCpuAvg: 0
						
					},
					os:{
						type:os.type(),
						platform:os.platform(),
						release:os.release(),
						cpuArch:os.arch()
					},
			};
				
			pm2.connect(function() {
				pm2.list(function(err,list) {
					
					pm2.disconnect();
					stat.errMsg = err;
					stat.processes=list;
					stat.PM2 = list ? list.length ? 'Online' : 'Offline' : 'Offline';
					return callback(null, stat);
				});	
				
			});
		
	} catch(err) {
		stat.errMsg = err;
		return callback(null, stat);
	} 
};

function getCpuTotalLoad(callback) {

	var cpuLoadInfo = {errMsg: '', cpusLoadAvg:0, cpusLoad:[]};
	cpu.totalLoad(function(error, results) {
		var cpuCores = results ? results.length : 0;
		if(error) {
			cpuLoadInfo.errMsg = error;
			return callback(null, cpuLoadInfo);
		} else
		if(cpuCores) {
			for(var i=0; i< cpuCores; i++) {
				cpuLoadInfo.cpusLoadAvg += results[i];
				cpuLoadInfo.cpusLoad.push(results[i]);
			}
			cpuLoadInfo.cpusLoadAvg = cpuLoadInfo.cpusLoadAvg / cpuCores; 
			return callback(null, cpuLoadInfo);
		}	
	});
};

function getNodeDetails(callback) {
	
	var nodeDetails = {errMsg: '', nodeDetails:''};
	cpu.nodeLoad(function(error, results) {
		if(error) {
			nodeDetails.errMsg = error;
			return callback(null, nodeDetails);
		} else
		if(typeof results.found != 'undefined' &&  results.found) {
			nodeDetails = results;
		}
			return callback(null, nodeDetails);
	});
};

function getPM2Logs(file,socket, event) {
	if(!file) return;
	var stats = fs.statSync(file);
	
	if(!stats['size']) {
		io.emit(event, 'No record found'); 
		return;
	}
	
	var rl = backwardsStream(file);
	rl.on('data', function(buf) {
		io.emit(event, buf.toString());   
	});
};

function stopPM2Proc(processId, callback){
	var rtn = {errMsg:'', status: false, successMsg: '', action: 'stop', 'processId': processId, data:''};
	pm2.connect(function() {
		pm2.stop(processId,function(err,details){
			pm2.disconnect();
			if(err){ 
				rtn.errMsg = err;
				return callback(null, rtn);
				
			}else {
				rtn.status = true;
				rtn.data = details;
				rtn.successMsg = rtn.action+': '+hostName +': successfully stopped the process id:'+processId;
				return callback(null, rtn);
				
			}
		})
	});
}


function restartPM2Proc(processId,callback){
	var rtn = {errMsg:'', status: false, successMsg: '', action: 'restart', 'processId': processId, data:''};
	pm2.connect(function() {
		pm2.restart(processId,function(err,details) {
			pm2.disconnect();
			if(err){ 
				rtn.errMsg = err;
				return callback(null,rtn);
			}else {
				rtn.status = true;
				rtn.data = details;
				rtn.successMsg = rtn.action+': '+hostName +': successfully restarted the process id:'+processId;
				return callback(null,rtn);
			}
			
		});
	});
}

function deletePM2Proc(processId, callback) {
	var rtn = {errMsg:'', status: false, successMsg: '', action: 'delete', 'processId': processId, data:''};
	pm2.connect(function() {
		pm2.delete(processId,function(err,details) {
			pm2.disconnect();
			if(err){ 
				rtn.errMsg = err;
				return callback(null,rtn);
			}else {
				rtn.status = true;
				rtn.data = details;
				rtn.successMsg = rtn.action+': '+hostName +': successfully deleted the process id:'+processId;
				return callback(null,rtn);
			}
			
		});
	});
}

function deletePM2App(appName, callback) {
	var rtn = {errMsg:'', status: false, successMsg: '', action: 'deleteApp', 'appName': appName, data:''};
	pm2.connect(function() {
		pm2.delete(appName,function(err,details) {
			pm2.disconnect();
			if(err){ 
				rtn.errMsg = err;
				return callback(null,rtn);
			}else {
				rtn.status = true;
				rtn.data = details;
				rtn.successMsg = rtn.action+': '+ hostName +': successfully deleted the application :'+appName;
				return callback(null,rtn);
			}
			
		});
	});
}

function formatBytes(bytes,decimals) {
	if(bytes == 0) return '0 Bytes';
	var k = 1000, dm = decimals || 2, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'], i = Math.floor(Math.log(bytes) / Math.log(k));
	
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}


asyncTasks.push(getServerStats,getCpuTotalLoad,getNodeDetails);

io.sockets.on('connection', function(socket) {
	socket.on('authorization', function(userId,fn) {
		helperUtil.isUserHasAdminAccess(userId, function(err, result){
			if (result && result.isAdmin != 'Y') {
				var rtn = {authorized:false ,msg : userId+' : unauthorized to view this page, please contact GIB analytics team' };
				fn(rtn);
				socket.disconnect();
			} else {
				execute(socket);
			}
		});
	});
});

/*Server side authentication - commented as its a cookie based and takes time to load the resposne data to UI */ 
// function cleanup() {
	// Object.keys(io.sockets.sockets).forEach(function(id) {
		// if(!io.sockets.sockets[id]['auth']) {
			 // io.sockets.connected[id].disconnect('close');
		// }
	// });
// }
				
function execute(socket) {
	socket.auth = true;
	/* sometimes the socket doesn't cleanup the listeners, and which keeps on increase with refresh of browsers and re-connect and eventually results in event memory leak to avoid */ 
	//cleanup();
	socket.broadcast.emit('message:board', hostName+':Socket connected to host');

	timer ? clearTimeout(timer) : '';
	cpuLoadTimer ? clearTimeout(cpuLoadTimer) : '';
	cpuMemTimer ? clearTimeout(cpuMemTimer) : '';
	
	/* func to get the server stats */
	(function sendServerDetails() {
		io.emit('message:board', hostName +':Getting server details from host');
		async.series(asyncTasks, function(error, results) {
			var stat = {errMsg: ''};
			stat = results[0];
			var processorsLength = results[0].processes ? Object.keys(results[0].processes).length : 0;
			var processorApps = [], found;
			var cacheArrayLength =  appState[hostName] && appState[hostName]['startApp'] ? Object.keys(appState[hostName]['startApp']).length : 0;					
			/* if cache been set, then update cache with PM2 status - it required to update the satus, if somehow the server went offline */
			if(cacheArrayLength) {
				/* Get the available app's */
				for(var i=0; i<processorsLength; i++) {
					if(results[0].processes[i]['name']) {
						if(!processorApps[results[0].processes[i]['name']]) {
							processorApps.push(results[0].processes[i]['name']);
						}
					};
				}
				
				for(var i=0; i<cacheArrayLength; i++ ) {
					found = false;
					for(var j=0; j<processorApps.length; j++) {
						if(Object.keys(appState[hostName]['startApp'])[i] == processorApps[j]) {
								found = true;
								appState[hostName]['startApp'][processorApps[j]] = 'available';
						}
					}
					/* update as not available only if there no instance of the app and not in the progress state */
					if(!found && appState[hostName]['startApp'][Object.keys(appState[hostName]['startApp'])[i]] != 'Inprogress') {
						appState[hostName]['startApp'][Object.keys(appState[hostName]['startApp'])[i]] = 'not available';
					}
				}
				
				cache.set("appState",appState);
				io.emit('cache',cache.get('appState'));
			}
			stat.errMsg = !stat.errMsg ? stat.errMsg = error : '';
			stat.monit.cpuLoad = results[1] ? typeof results[1].cpusLoadAvg != 'undefined' ? results[1].cpusLoadAvg : 0 : 0;
			stat.monit.nodeCnt =  results[2] ? typeof results[2].found != 'undefined' ? results[2].found.length : 0 : 0;
			stat.monit.nodeCpuAvg = results[2] ? typeof results[2].load != 'undefined' ? results[2].load : 0 :0;
			io.emit('message', stat);
			io.emit('message:board', hostName +':Got server details from host');
			timer = setTimeout(sendServerDetails, appConfigData.timeIntervalToSendData);	
		});
	})();
	
	/* Notify if cpu mem reaches the threshold value */
	eNotify && (function notifyCpuMemUsage() {
		async.auto([function(callback){ callback(null,{ total: os.totalmem(), free: os.freemem() } ) }], function(error, results) {
			var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
			var hostname = os.hostname();
			if(!error) {
				var usage = parseInt(((results[0].total - results[0].free)/ results[0].total ) * 100, 10);
				if(usage >= eNotifychkd.cpuMemory.max && eNotify && eNotifychkd.cpuMemory.status && eNotifychkd.cpuMemory.count < appConfigData.notification.maxEmailtoSend) {
					eNotifychkd.cpuMemory.count++;
					eOptions.subject = hostname+': Memory usage reached '+usage+'%',
					eOptions.mailContent = 'This is to notify that memory usage reached '+usage+'% in server '+hostname;
					notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
					notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
					sendNotification.sendMail(eOptions);
					cpuMemTimer = setTimeout(notifyCpuMemUsage, eNotifychkd.cpuMemory.interval);
				} else {
					clearTimeout(cpuLoadTimer);
				}
			}
		})
	})();
	
	/* Notify if cpu load reaches the threshold value */
	eNotify && (function notifyCpuLoad() {
		async.auto([getCpuTotalLoad], function(error, results) {
			var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
			var hostname = os.hostname();
			if(!error) {
				var load = results[0].cpusLoadAvg ? results[0].cpusLoadAvg : 0;
				if(load >= eNotifychkd.cpuLoad.max && eNotify && eNotifychkd.cpuLoad.status && eNotifychkd.cpuLoad.count < appConfigData.notification.maxEmailtoSend) {
					eNotifychkd.cpuLoad.count++;
					eOptions.subject = hostname+': CPU load reached '+load+'%',
					eOptions.mailContent = 'This is to notify that CPU load reached '+load+'% in sever '+hostname;
					notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
					notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
					sendNotification.sendMail(eOptions);
					console.log(eNotifychkd.cpuLoad.interval);
					console.log('checking the cpu load');
					cpuLoadTimer = setTimeout(notifyCpuLoad, eNotifychkd.cpuLoad.interval);
				} else {
					clearTimeout(cpuLoadTimer);
				}
			}
		})
	})();

	socket.on('operation', function(data) {
		switch(data.action) {
		
			case 'stop' : 
								io.emit('message:board', hostName +':Calling stop operation');
								var processId = typeof data.processId != 'undefined' ? data.processId : '';
								var userId = data.userId ? data.userId : '';
								var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
								
								async.auto([stopPM2Proc.bind(null,processId)], function(error, results){
									if(error){
										io.emit('operation:status', {errMsg: error});
										io.emit('message:board', hostName +':Executed stop operation with error');
									} else {
										io.emit('operation:status', results[0]);
										io.emit('message:board', hostName +':Executed stop operation with success');
										
										if(eNotify && eNotifychkd.stop) {
											eOptions.subject = data.host+': stopped process :'+ processId,
											eOptions.mailContent = 'This is to notify that in server '+data.host+' an action been performed on behalf of user '+userId+", hence the reason: "+results[0].successMsg;
											notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
											notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
											io.emit('notify',notifyMsg);
											sendNotification.sendMail(eOptions);
											io.emit('message:board', hostName +':Sent email notification to users');	
										}
									}
								});
											
								break;
			case 'restart' :
								io.emit('message:board', hostName +':Calling restart operation');
								var processId = typeof data.processId != 'undefined' ? data.processId : '';
								var userId = data.userId ? data.userId : '';
								var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
								
								async.auto([restartPM2Proc.bind(null,processId)], function(error, results){
									if(error){
										io.emit('operation:status', {errMsg: error});
										io.emit('message:board', hostName +':Executed restart operation with error');
									} else {
										io.emit('operation:status', results[0]);
										io.emit('message:board', hostName +':Executed restart operation with success');
										
										if(eNotify && eNotifychkd.restart) {
											eOptions.subject = data.host+': restarted the process :'+ processId,
											eOptions.mailContent = 'This is to notify that in server '+data.host+' an action been performed on behalf of user '+userId+", hence the reason: "+results[0].successMsg;
											notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
											notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
											io.emit('notify',notifyMsg);
											sendNotification.sendMail(eOptions);
											io.emit('message:board', hostName +':Sent email notification to users');	
										}
									}
					
								});							
								break;
										
			case 'delete' :
								io.emit('message:board', hostName +':Calling delete operation');
								var processId = typeof data.processId != 'undefined' ? data.processId : '';
								var userId = data.userId ? data.userId : '';
								var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
								
								async.series([deletePM2Proc.bind(null,processId), getServerStats], function(error, results){
										var appName = results[0]['data'] && results[0]['data'][0]['name'] ? results[0]['data'][0]['name'] : '';
										var processorsLength = results[1].processes ? Object.keys(results[1].processes).length : 0;
										var processorApps = [];
										
										if(!appState[data.host]) appState[data.host] = {};
										if(!appState[data.host]['startApp'])  appState[data.host]['startApp'] = {};
										
										/* Get the available app's */
										for(var i=0; i<processorsLength; i++) {
											if(results[1].processes[i]['name'] == appName) {
												processorApps.push(appName);
												break;
											};
										}
										
								
									if(error){
										io.emit('operation:status', {errMsg: error});
										io.emit('message:board', hostName +':Executed delete operation with error');
									} else {
									
										if(!processorApps.length) {
											 appState[data.host]['startApp'][appName] = 'not available';
											 cache.set("appState",appState);
											 io.emit('cache',cache.get('appState'));
										}
										
										io.emit('operation:status', results[0]);
										io.emit('message:board', hostName +':Executed delete operation with success');
										
										if(eNotify && eNotifychkd['delete']) {
											eOptions.subject = data.host+': deleted the process :'+ processId,
											eOptions.mailContent = 'This is to notify that in server '+data.host+' an action been performed on behalf of user '+userId+", hence the reason: "+results[0].successMsg;
											notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
											notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
											io.emit('notify',notifyMsg);
											sendNotification.sendMail(eOptions);
											io.emit('message:board', hostName +':Sent email notification to users');
											
										}
									}
									
								});
								
								break;
					
			case 'startApp' :
									
									var rtn = {errMsg:'', status: false, successMsg: '', action: data.action, appName: ''};
									var startupScript = data.appList.startupScript ? data.appList.startupScript : '';
									var appName = data.appList.name;
									var port = data.appList.port;
									io.emit('message:board', hostName +':starting the application '+appName);
									var appLoc =  data.appList.startupScriptLoc ? data.appList.startupScriptLoc : '';
									var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
									var userId = data.userId ? data.userId : '';
									var serverName = hostName.toLowerCase();
									
									if(!appState[serverName]) appState[serverName] = {};
									if(!appState[serverName]['startApp'])  appState[serverName]['startApp'] = {};
									appState[serverName]['startApp'][appName] = 'Inprogress';
									
									cache.set("appState",appState);
									io.emit('cache',cache.get('appState'));
									
									portscanner.checkPortStatus(port, '127.0.0.1', function(error, status) {
										if(error) {
											rtn.status = false;
											rtn.errMsg = data.action+' : '+hostName+' : '+error;
											rtn.appName = appName;
											io.emit('operation:status', rtn);
											io.emit('message:board', hostName +':Error starting the application '+appName);
											
											appState[serverName]['startApp'][appName] = 'not available';
											cache.set("appState",appState);
											io.emit('cache',cache.get('appState'));
											return;

										} else if(status !=='closed') {
										
											rtn.status = false;
											rtn.errMsg = data.action+' : '+hostName+': The port '+port+' application -'+appName+' trying to use already been taken';
											rtn.appName = appName;
											io.emit('operation:status', rtn);
											io.emit('message:board', hostName +':Error starting the application '+appName);
											
											appState[serverName]['startApp'][appName] = 'not available';
											cache.set("appState",appState);
											io.emit('cache',cache.get('appState'));
											return;
										} else if(status == 'closed') {
									
											var ls = execFile(startupScript,[],{'cwd': appLoc}, function (error,stdout, stdin) {
												if (error) {
													rtn.status = false;
													rtn.errMsg = data.action+': '+error;
													rtn.appName = appName;
													io.emit('operation:status', rtn);
													io.emit('message:board', hostName +':Error starting the application '+appName);
													
													appState[serverName]['startApp'][appName] = 'not available';
													cache.set("appState",appState);
													io.emit('cache',cache.get('appState'));
													
												} else {
													rtn.status = true;
													rtn.successMsg =  data.host+': '+'Successfully launched the application: '+appName;
													rtn.appName = appName;
													io.emit('operation:status', rtn);
													io.emit('message:board', hostName +':Successfully started the application '+appName);
													
													appState[serverName]['startApp'][appName] = 'available';
													cache.set("appState",appState);
													io.emit('cache',cache.get('appState'));
													
													if(eNotify && eNotifychkd.startApp) {
														eOptions.subject = data.host+': started the application :'+ appName,
														eOptions.mailContent = 'This is to notify that in sever '+data.host+' an action been performed on behalf of user '+userId+', hence the reason: '+ rtn.successMsg;
														notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
														notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
														io.emit('notify',notifyMsg);
														sendNotification.sendMail(eOptions);
														io.emit('message:board', hostName +':Sent email notification to users');
														
													}
												}
												
											});
										}
									});
									
									break;
											
			case 'pm2Log'	:
									var rtn = {errMsg:'', status: false, successMsg: '', action: data.action};
									var pm2Home;
									var listCnt = 0;
									pm2.connect(function() {
										pm2.list(function(err,list) {
											pm2.disconnect();
											listCnt = list ? list.length : 0;
											if(listCnt) {
												pm2Home = list[0]['pm2_env']['PM2_HOME'];
												io.emit('message:board', hostName +':Getting PM2 Log from path '+pm2Home);
												getPM2Logs(pm2Home+'\\pm2.log',socket,'log:pm2');
											} else {
												rtn.status = false;
												rtn.errMsg = 'No record found, looks there won\'t exists any PM2 instance';
												io.emit('log:pm2', rtn);
											}
										});							
									});
									break;
			case 'outLog'	:
									var rtn = {errMsg:'', status: false, successMsg: '', action: data.action};
									var file = '';
									var listCnt = 0;
									var processId = typeof data.processId != 'undefined' ? data.processId : '';
									pm2.connect(function() {
										pm2.list(function(err,list){
											listCnt = list ? list.length : 0;
											if(err) {
												rtn.errMsg = err;
												io.emit('log:out', rtn);
											} if(!listCnt) {
												rtn.status = false;
												rtn.errMsg = 'No data found';
												io.emit('log:out', rtn);
											} else {
												for(var i=0; i < listCnt; i++ ) {
													if(list[i].pm_id == processId) {
														file = list[i].pm2_env.pm_out_log_path;
														io.emit('message:board', hostName +':Getting PM2 out log from path '+file);
														getPM2Logs(file,socket, 'log:out');
														break;
													}
												}
											}
											pm2.disconnect();	
										});
									});
									break;
			case 'errorLog'	:
									var rtn = {errMsg:'', status: false, successMsg: '', action: data.action};
									var file = '';
									var listCnt = 0;
									var processId = typeof data.processId != 'undefined' ? data.processId : '';
									pm2.connect(function() {
										pm2.list(function(err,list){
											listCnt = list ? list.length : 0;
											if(err) {
												rtn.errMsg = err;
												io.emit('log:error', rtn);
											} if(!listCnt) {
												rtn.status = false;
												rtn.errMsg = 'No data found';
												io.emit('log:error', rtn);
											} else {
												for(var i=0; i < listCnt; i++ ) {
													if(list[i].pm_id == processId) {
														file = list[i].pm2_env.pm_err_log_path;
														io.emit('message:board', hostName +':Getting PM2 error log from path '+file);
														getPM2Logs(file,socket, 'log:error');
														break;
													}
												}
											}
											pm2.disconnect();	
										});
									});
									break;
									
			case 'deleteApp' :
									var rtn = {errMsg:'', status: false, successMsg: '', action: data.action};
									var appName = data.appName;
									var serverName = data.host;
									var userId = data.userId ? data.userId : '';
									var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
									
									if(!appState[serverName]) appState[serverName] = {};
									if(!appState[serverName]['startApp'])  appState[serverName]['startApp'] = {};
									
									if(!appName) {
										rtn.errMsg = 'deleteApp: Please select the app name';
										io.emit('operation:status', rtn);
										return;
									} 
									
									io.emit('message:board', hostName +':Calling delete operation for application '+appName);
									async.auto([deletePM2App.bind(null,appName)], function(error, results) {
										if(error){
											io.emit('operation:status', {errMsg: error});
											io.emit('message:board', hostName +':Executed delete operation with error for application '+appName);
											appState[serverName]['startApp'][appName] = 'available';
											
											cache.set("appState",appState);
											io.emit('cache', appState);
											
										} else {
											
											io.emit('operation:status', results[0]);
											io.emit('message:board', hostName +':Executed delete operation with success for application '+appName);
											appState[serverName]['startApp'][appName] = 'not available';
											
											cache.set("appState",appState);
											io.emit('cache', appState);
											
											if(eNotify && eNotifychkd.deleteApp) {
												eOptions.subject = data.host+': deleted the App :'+ appName,
												eOptions.mailContent = 'This is to notify that in server '+data.host+' an action been performed on behalf of user '+userId+", hence the reason: "+results[0].successMsg;
												notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent });
												notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
												io.emit('notify',notifyMsg);
												sendNotification.sendMail(eOptions);
												io.emit('message:board', hostName +':Sent email notification to users');
												
											}
										}
										
									});							
									break;
						
			case 'refresh'	:
									socket.emit('message:board', hostName +':Calling refresh operation');
									
									timer ? clearTimeout(timer) : '';
								
									(function sendServerDetails() {
										socket.emit('message:board', hostName +':Getting server details from host');
										async.auto(asyncTasks, function(error, results) {
											var stat = {errMsg: ''};
											stat = results[0];
											stat.errMsg = !stat.errMsg ? stat.errMsg = error : '';
											stat.monit.cpuLoad = results[1] ? typeof results[1].cpusLoadAvg != 'undefined' ? results[1].cpusLoadAvg : 0 : 0;
											stat.monit.nodeCnt =  results[2] ? typeof results[2].found != 'undefined' ? results[2].found.length : 0 : 0;
											stat.monit.nodeCpuAvg = results[2] ? typeof results[2].load != 'undefined' ? results[2].load : 0 :0;
											socket.emit('message', stat);
											socket.emit('message:board', hostName +':Got server details from host');
											timer = setTimeout(sendServerDetails, appConfigData.timeIntervalToSendData);
										});
									})();
									break;
			case 'closeSocket'	:
									socket.emit('message:board', hostName +':Called to close socket');
									timer ? clearTimeout(timer) : '';
									cpuLoadTimer ? clearTimeout(cpuLoadTimer) : '';
									cpuMemTimer ? clearTimeout(cpuMemTimer) : '';
									socket.disconnect();
									break;
			case 'notify'	:
									var rtn = { action: 'notify', data: notifyMsg};
									io.emit('operation:status', rtn);
									break;
												
			case 'cache'	:
									var serverName = data.host;
									if(!appState.length) {
										async.series([getServerStats],function(error, results) {
											var processorsLength = results[0].processes ? Object.keys(results[0].processes).length : 0;
											if(!appState[serverName]) appState[serverName] = {};
											if(!appState[serverName]['startApp'])  appState[serverName]['startApp'] = {};
											/* Get the available app's */
											for(var i=0; i<processorsLength; i++) {
												appState[serverName]['startApp'][results[0].processes[i]['name']] = 'available';
											}
											cache.set("appState",appState);
											io.emit('cache',cache.get('appState'));
										});
									} else {
										io.emit('cache',cache.get('appState'));
									}
									
									break;							
												
			case 'default' :
									break;
					 
		}
	});

	socket.on('error', function() {
		io.emit('message:board', hostName +':Error while connecting to socket');
		timer ? clearTimeout(timer) : '';
		cpuLoadTimer ? clearTimeout(cpuLoadTimer) : '';
		cpuMemTimer ? clearTimeout(cpuMemTimer) : '';
		socket.disconnect();
	});

	socket.on('disconnect', function () {
		io.emit('message:board', hostName +':Socket disconnected');
		
		timer ? clearTimeout(timer) : '';
		cpuLoadTimer ? clearTimeout(cpuLoadTimer) : '';
		cpuMemTimer ? clearTimeout(cpuMemTimer) : '';
	});
									

}

/* if any uncaught exception catch from PM2 don't kill the node thread 	*/
process.on('uncaughtException', function (error) {
	var eOptions = { from: appConfigData.notification.email.from, to: appConfigData.notification.email.to, subject: '', mailContent: '' };
	var ErrDesc = JSON.stringify(error) +' '+error;
	var hostname = os.hostname();
	eOptions.subject = hostname+': An uncaught exception occured',
	eOptions.mailContent ='An uncaughtException Exception in host :'+hostname+"\n"+ErrDesc;
	notifyMsg.unshift({date: new Date(), msg: eOptions.mailContent});
	notifyMsg.splice(appConfigData.notification.maxNotifyMsgLength);
	if(error && eNotify && eNotifychkd.uncaughtException.status &&  eNotifychkd.uncaughtException.count < appConfigData.notification.maxEmailtoSend ) {
		eNotifychkd.uncaughtException.count++;
		sendNotification.sendMail(eOptions);
	}
});
