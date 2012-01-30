var fs = require("fs");
var engineCalled = false;

function engine(io) {
  
	var players = 0;
	var expectedPlayers = 4;
	var aiPlayers = 1;
	var startingFish = 40;
	var chanceOfCatch = 1.0;
	var spawnFactor = 4.0;

	function aiAgent (name) {
		this.name = name;
		this.type = 'ai';
		this.greediness = 0.5;
		this.fishCaught = 0;
		this.money = 100;
		this.status = 'At port';
		this.intendedCasts = Math.round(((startingFish - (startingFish / spawnFactor)) / expectedPlayers) * 2 * this.greediness / chanceOfCatch);
		this.actualCasts = 0;
	}

	function humanAgent (name) {
		this.name = name;
		this.type = 'human';
		this.greediness = null;
		this.fishCaught = 0;
		this.money = 100;
		this.status = 'At port';
		this.actualCasts = 0;
	}

	var agents = new Array();
	var gs = { expectedPlayers : 4,
    	       expectedHumans : 3,
        	   actualPlayers : 0,
        	   actualHumans : 0,
        	   mode : 'standby',
        	   totalSeasons : 4,
        	   currentSeason : 0,
        	   seasonDuration : 30,
        	   pauseDuration : 10,
        	   certainFish : 40,
        	   mysteryFish : 0,
        	   actualMysteryFish : 0,
        	   costDepart : 10,
        	   costCast : 2,
        	   costAtSea : 1,
        	   valueFish : 5,
        	   chanceOfCatch : 1.00,
        	   spawnFactor : 4.0,
        	   players : agents,
        	   status : 'waiting' };

	for (i = 0; i < gs.expectedPlayers - gs.expectedHumans; i++) {
		agents[i] = new aiAgent('Robot ' + i);
		gs.actualPlayers++;
	}

	
	var beginTimer = false;
	io.sockets.on('connection', function (socket) {
		agents[gs.actualPlayers] = new humanAgent(gs.actualPlayers);
		var myID = gs.actualPlayers++;
		gs.actualHumans++;
	
		socket.set('gamesettings', gs, function() {
			socket.emit('gamesettings', gs);
		});
	
		socket.set('myID', myID, function() {
			socket.emit('myID', myID);
		});
	
		socket.set('agents', agents, function() {
			socket.emit('agents', agents);
		});
	
		if (gs.actualPlayers == gs.expectedPlayers) {
			gs.status = 'running';
			gs.currentSeason = 1;
			io.sockets.emit('gamesettings', gs);
			io.sockets.emit('begin', 'All agents connected!');
		}

		socket.on('toSea', function (data) {
			console.log("A player sailed to sea: " + data.id);
			gs.players[data.id].status = 'At sea';
			gs.players[data.id].money -= gs.costDepart;
			io.sockets.emit('gamesettings', gs);
		});

		socket.on('toPort', function (data) {
			console.log("A player returned to port: " + data.id);
			gs.players[data.id].status = 'At port';
			io.sockets.emit('gamesettings', gs);
		});

		socket.on('fishing', function (data) {
			console.log("A player tried to fish: " + data.id);
			gs.players[data.id].money -= gs.costCast;
			gs.players[data.id].actualCasts++;
			if (gs.certainFish + gs.actualMysteryFish > 0) {
				gs.players[data.id].money += gs.valueFish;
				gs.players[data.id].fishCaught++;
				// Right now we're only removing actual fish, not mystery fish...
				gs.certainFish -= 1;
			}
			io.sockets.emit('gamesettings', gs);
		});
	
		// Begin timekeeping
		if (beginTimer == false) {
			beginTimer = true;
			timer();
		}
	});

	var secondsSinceStart = 0;
	var t;
	var endTimer = false;

	function timer() {
		if (gs.actualPlayers == gs.expectedPlayers) {
			if (gs.status == 'running') {
				secondsSinceStart += 1;
				if (gs.seasonDuration <= secondsSinceStart) {
					gs.status = 'paused';
					secondsSinceStart = 0;
					for (i = 0; i < gs.players.length; i++) {
						gs.players[i].status = 'At port';
						gs.players[i].actualCasts = 0;
					}
					if (gs.currentSeason < gs.totalSeasons) {
						console.log('Season ended, beginning pause period.');
						io.sockets.emit('gamesettings', gs);
						io.sockets.emit('endseason', gs.currentSeason);
					} else {
						gs.status = 'over';
						console.log('Simulation ended.');
						io.sockets.emit('gamesettings', gs);
						io.sockets.emit('gameover', 'gameover');
						endTimer = true;
					}
				} else {
					console.log('Seconds since start of season: ' + secondsSinceStart);
					io.sockets.emit('time', secondsSinceStart);
					for (i = 0; i < gs.players.length; i++) {
						if (gs.players[i].type == 'ai') {
							aiActions(i);
						}
						if (gs.players[i].status == 'At sea') {
							gs.players[i].money -= gs.costAtSea;
						}
					}
					io.sockets.emit('gamesettings', gs);
				}
			} else {
				secondsSinceStart += 1;
				if (gs.pauseDuration <= secondsSinceStart) {
					gs.certainFish *= gs.spawnFactor;
					gs.actualMysteryFish *= gs.spawnFactor;
					gs.status = 'running';
					secondsSinceStart = 0;
					gs.currentSeason += 1;
					console.log('Beginning new season.');
					io.sockets.emit('begin', 'New season');
				} else {
					console.log('Seconds since pausing: ' + secondsSinceStart);
					io.sockets.emit('pausetime', secondsSinceStart);
				}
			}
		} else {
			console.log('Waiting for players.');
		}
	
		if (!endTimer) {
			t = setTimeout(timer, 1000);
		} else {
			console.log('Over and out.');
		}
	}

	function aiActions(ag) {
		if ((gs.players[ag].intendedCasts > gs.players[ag].actualCasts) && 	(gs.players[ag].status == 'At port') &&
		(gs.certainFish + gs.actualMysteryFish > 0)) {
			console.log("A player sailed to sea: " + ag);
			gs.players[ag].status = 'At sea';
			gs.players[ag].money -= gs.costDepart;
		} else if ((gs.players[ag].intendedCasts > gs.players[ag].actualCasts) && 	(gs.players[ag].status == 'At sea') &&
		(gs.certainFish + gs.actualMysteryFish > 0)) {
			console.log("A player tried to fish: " + ag);
			gs.players[ag].money -= gs.costCast;
			gs.players[ag].money += gs.valueFish;
			gs.players[ag].actualCasts ++;
			gs.certainFish -= 1;
			gs.players[ag].fishCaught++;
		} else if (((gs.players[ag].intendedCasts <= gs.players[ag].actualCasts) || (gs.certainFish + gs.actualMysteryFish <= 0)) && gs.players[ag].status == 'At sea') {
			gs.players[ag].status = 'At port';
		}
		io.sockets.emit('gamesettings', gs);
	}
}


function fish(response, io) {
	console.log("Request handler 'fish' was called.");
	fs.readFile(__dirname + '/main.html',
	function (err, data) {
		if (err) {
			response.writeHead(500);
			return response.end('Error loading main.html');
		}
    	response.writeHead(200);
    	response.end(data);
  	});
  	
  	if (engineCalled == false) {
  		engineCalled = true;
  		engine(io);
  	}
}

function mainadmin(response, io) {
  console.log("Request handler 'mainadmin' was called.");
  fs.readFile(__dirname + '/mainadmin.html',
  function (err, data) {
    if (err) {
      response.writeHead(500);
      return response.end('Error loading mainadmin.html');
    }
    response.writeHead(200);
    response.end(data);
  });
}

exports.fish = fish;
exports.mainadmin = mainadmin;

