var fs = require("fs");
var engineCalled = false;
var runningSims = "--none currently--";

function engine(io) {
    var oceans = new Array();
    var parents = {};
    var logs = new Array();
    var timestamper = new Date();
    var group;
    var t;
    var beginTimer = false;
    var endTimer = false;

    function timer() {
        if (!endTimer) {
            for (game in oceans) {
                if (oceans[game].timable == true) {
                    timeStep(game);
                }
            }
            t = setTimeout(timer, 1000);
        } else {
            console.log('Finishing timer---we are done.');
            beginTimer = false;
            endTimer = true;
        }
    }

    function endSimulation(gameName) {
        g = oceans[gameName];
        g.timable = false;
        g.status = 'over';
        console.log('Simulation ended for gameroom ' + gameName);
        logs[gameName] += new Date().toString() + ", Simulation ended.\n";
        io.sockets.in(gameName).emit('gamesettings', g);
        io.sockets.in(gameName).emit('gameover', 'gameover');
        logRun(g, gameName);
    }

    function timeStep(gameName) {
        g = oceans[gameName];
        if (g.actualPlayers == g.expectedPlayers && g.status != "over") {
            if (g.status == 'waiting') {
                console.log('Waiting for all players to read the preparatory text and click on Go Fishing, in gameroom ' + gameName);
            } else if (g.status == 'readying') {
                g.currentSeconds += 1;
                if (g.currentSeconds > g.initialDelay) {
                    g.status = 'running';
                    g.currentSeconds = 0;
                    g.seasonsData[1].initialFish = g.certainFish + g.actualMysteryFish;
                    console.log('Beginning first season in gameroom ' + gameName);
                    logs[gameName] += new Date().toString() + ", Beginning first season.\n";
                    io.sockets.in(gameName).emit('begin', 'Beginning first season');
                    io.sockets.in(gameName).emit('gamesettings', g);
                }
            } else if (g.status == 'running') {
                g.currentSeconds += 1;
                if (g.seasonDuration <= g.currentSeconds) {
                    g.status = 'resting';
                    g.currentSeconds = 0;
                    for (i = 0; i < g.players.length; i++) {
                        g.players[i].status = 'At port';
                        g.players[i].actualCasts = 0;
                    }
                    g.seasonsData[g.currentSeason].endFish = g.certainFish + g.actualMysteryFish;
                    if (g.currentSeason < g.totalSeasons) {
                        console.log('Season ended on gameroom ' + gameName + ', beginning rest period.');
                        logs[gameName] += new Date().toString() + ", Season ended; beginning rest period.\n";
                        io.sockets.in(gameName).emit('gamesettings', g);
                        io.sockets.in(gameName).emit('endseason', g.currentSeason);
                    } else {
                        endSimulation(gameName);
                    }
                } else {
                    console.log('Seconds in season for gameroom ' + gameName + ': ' + g.currentSeconds);
                    io.sockets.in(gameName).emit('time', g.currentSeconds);
                    for (i = 0; i < g.players.length; i++) {
                        if (g.players[i].type == 'ai') {
                            aiActions(g, gameName, i);
                        }
                        if (g.players[i].status == 'At sea') {
                            g.players[i].money -= g.costAtSea;
                            g.players[i].endMoneyPerSeason[g.currentSeason] = g.players[i].money;
                        }
                    }
                    io.sockets.in(gameName).emit('gamesettings', g);
                }
            } else if (g.status == "resting") {
                g.currentSeconds += 1;
                if (g.restDuration <= g.currentSeconds) {
                    g.certainFish = Math.min(g.certainFish * g.spawnFactor, g.startingFish);
                    g.actualMysteryFish = Math.min(g.actualMysteryFish * g.spawnFactor, g.startingMysteryFish);
                    g.status = 'running';
                    g.currentSeconds = 0;
                    g.currentSeason += 1;
                    g.seasonsData[g.currentSeason].initialFish = g.certainFish + g.actualMysteryFish;
                    for (i = 0; i < g.players.length; i++) {
                        g.players[i].fishCaughtPerSeason[g.currentSeason] = 0;
                        g.players[i].startMoneyPerSeason[g.currentSeason] = g.players[i].money;
                        g.players[i].endMoneyPerSeason[g.currentSeason] = g.players[i].money;

                        if (g.players[i].type == 'ai') {
                            g.players[i].intendedCasts = Math.round(((g.certainFish + g.actualMysteryFish - ((g.certainFish + g.actualMysteryFish) / g.spawnFactor)) / g.players.length) * 2 * g.players[i].greediness / g.chanceOfCatch);
                        }					}
                    console.log('Beginning new season in gameroom ' + gameName);
                    logs[gameName] += new Date().toString() + ", Beginning new season.\n";
                    io.sockets.in(gameName).emit('begin', 'New season');
                } else {
                    console.log('Seconds since resting in gameroom ' + gameName + ': ' + g.currentSeconds);
                    io.sockets.in(gameName).emit('resttime', g.currentSeconds);
                    io.sockets.in(gameName).emit('gamesettings', g);
                }
            } else if (g.status == "paused") {
                console.log("Gameroom " + gameName + " paused by user.");
            } else {
                // Weird state
                console.log("Game state unaccounted for: " + g.status);
            }
        } else {
            console.log('Waiting for players in gameroom ' + gameName);
        }
    }

    function checkForDepletion(g, gameRoom) {
        if (g.certainFish + g.actualMysteryFish <= 0) {
            g.depleted = true;
            endSimulation(gameRoom);
        }
    }

    function tryToFish(g, gameRoom, index, name) {
        console.log("A fisher tried to fish: " + name + ", gameroom " + gameRoom + ".");
        var player = g.players[index];
        player.money -= g.costCast;
        player.actualCasts++;
        if ((g.certainFish + g.actualMysteryFish > 0) && Math.random() <= g.chanceOfCatch) {
            logs[gameRoom] += new Date().toString() + ", Fisher " + name + " tried to fish successfully.\n";
            player.money += g.valueFish;
            player.fishCaught++;
            player.fishCaughtPerSeason[g.currentSeason]++;
            player.endMoneyPerSeason[g.currentSeason] = player.money;

            if (Math.floor(Math.random() * (g.certainFish + g.actualMysteryFish)) < g.certainFish) {
                g.certainFish -= 1;
            } else {
                g.actualMysteryFish -= 1;
            }
            checkForDepletion(g, gameRoom);
        } else {
            logs[gameRoom] += new Date().toString() + ", Fisher " + name + " tried to fish unsuccessfully.\n";
        }
    }

    function aiActions(g, gameName, agentID) {
        agent = g.players[agentID];
        if ((agent.intendedCasts > agent.actualCasts) && (agent.status == 'At port') && (g.certainFish + g.actualMysteryFish > 0)) {
            console.log("A player sailed to sea: " + agent.name + ", gameroom " + gameName + ".");
            logs[gameName] += new Date().toString() + ", Fisher " + agent.name + " sailed to sea.\n";
            agent.status = 'At sea';
            agent.money -= g.costDepart;
            agent.endMoneyPerSeason[g.currentSeason] = agent.money;
        } else if ((agent.intendedCasts > agent.actualCasts) && (agent.status == 'At sea') && (g.certainFish + g.actualMysteryFish > 0)) {
            tryToFish(g, gameName, agentID, agent.name);
        } else if (((agent.intendedCasts <= agent.actualCasts) || (g.certainFish + g.actualMysteryFish <= 0)) && agent.status == 'At sea') {
            agent.status = 'At port';
            console.log(logs[gameName]);
            logs[gameName] += new Date().toString() + ", Fisher " + agent.name + " returned to port.\n";
        }
        io.sockets.in(gameName).emit('gamesettings', g);
    }

    function aiAgent (name, greed, expectedPlayers, startingFish, actualMysteryFish, spawnFactor, chanceOfCatch) {
        this.name = name;
        this.type = 'ai';
        this.greediness = greed;
        this.fishCaught = 0;
        this.fishCaughtPerSeason = new Array();
        this.startMoney = 100;
        this.money = 100;
        this.startMoneyPerSeason = new Array();
        this.endMoneyPerSeason = new Array();
        this.status = 'At port';
        this.intendedCasts = Math.round(((startingFish + actualMysteryFish - ((startingFish + actualMysteryFish) / spawnFactor)) / expectedPlayers) * 2 * this.greediness / chanceOfCatch);
        this.actualCasts = 0;
        this.readRules = true;
    }

    function humanAgent (name) {
        this.name = name;
        this.type = 'human';
        this.greediness = null;
        this.fishCaught = 0;
        this.fishCaughtPerSeason = new Array();
        this.startMoney = 100;
        this.money = 100;
        this.startMoneyPerSeason = new Array();
        this.endMoneyPerSeason = new Array();
        this.status = 'At port';
        this.actualCasts = 0;
        this.readRules = false;
    }

    function seasonData (number) {
        this.number = number;
        this.initialFish = 0;
        this.endFish = 0;
    }

    function Parent (parentName, numOceans) {
        this.name = parentName;
        this.numOceans = numOceans;
    }

    function gameParameters (gs, parentName) {
        this.parent = parentName;
        this.players = new Array();
        this.seasonsData = new Array();
        this.actualPlayers = 0;
        this.actualHumans = 0;
        this.timable = true;
        this.currentSeason = 0;
        this.status = "waiting";
        this.currentSeconds = 0;
        this.debug = true;
        this.unpauseState = "";
        this.pausedBy = null;
        this.depleted = false;

        if (gs != null) {
            this.numOceans = gs.numOceans;
            this.expectedPlayers = gs.numFishers;
            this.expectedHumans = gs.numHumans;
            this.totalSeasons = gs.numSeasons;
            this.seasonDuration = gs.seasonDuration;
            this.initialDelay = gs.initialDelay;
            this.restDuration = gs.restDuration;
            this.spawnFactor = gs.spawnFactor;
            this.chanceOfCatch = gs.chanceOfCatch;
            this.costDepart = gs.costDepart;
            this.costAtSea = gs.costAtSea;
            this.costCast = gs.costCast;
            this.valueFish = gs.valueFish;
            this.startingFish = gs.certainFish;
            this.certainFish = gs.certainFish;
            this.mysteryFish = gs.mysteryFish;
            this.startingMysteryFish = gs.actualMysteryFish;
            this.actualMysteryFish = gs.actualMysteryFish;
            this.showOtherFishers = gs.showOtherFishers;
            this.showFisherNames = gs.showFisherNames;
            this.showFisherStatus = gs.showFisherStatus;
            this.showFishCaught = gs.showFishCaught;
            this.showBalance = gs.showBalance;
            this.pauseEnabled = gs.pauseEnabled;
            this.prepText = gs.prepText;
            this.depletedText = gs.depletedText;
            this.endText = gs.endText;
            for (i = 0; i < this.expectedPlayers - this.expectedHumans; i++) {
                this.players[i] = new aiAgent(gs.robots[i].name, gs.robots[i].greed, this.expectedPlayers,
                    this.startingFish, this.actualMysteryFish, this.spawnFactor, this.chanceOfCatch);
                this.actualPlayers++;
            }
        } else {
            this.numOceans = 1;
            this.expectedPlayers = 4;
            this.expectedHumans = 1;
            this.totalSeasons = 4;
            this.seasonDuration = 60;
            this.initialDelay = 5;
            this.restDuration = 10;
            this.spawnFactor = 4.00;
            this.chanceOfCatch = 1.00;
            this.costDepart = 0;
            this.costAtSea = 0;
            this.costCast = 0;
            this.valueFish = 3;
            this.startingFish = 40;
            this.certainFish = 40;
            this.mysteryFish = 10;
            this.startingMysteryFish = 5;
            this.actualMysteryFish = 5;
            this.showOtherFishers = true;
            this.showFisherNames = true;
            this.showFisherStatus = true;
            this.showFishCaught = true;
            this.showBalance = true;
            this.pauseEnabled = true;
            this.prepText = "FISH simulates fishing in an ocean. You and the other fishers are the only fishers " +
                "in this ocean. All the fishers see the same ocean that you do. At the beginning, the " +
                "number of fish will be displayed on the screen. However, sometimes there is some " +
                "uncertainty about the number of fish. In those cases, 'mystery fish' will be shown on " +
                "the screen as well, and the number is displayed as a certain range, not as an absolute " +
                "number. Once the simulation begins, you and the other fishers may catch as many of these " +
                "fish as you like. Once  you have taken as many fish as you want, you return to port " +
                "with your catches, and the first season ends. Then the fish spawn for the next season, " +
                "if any are left to spawn (if no fish are left, they cannot spawn). For every fish left " +
                "at the end of one season, two fish will be available to be caught in the next season. " +
                "However, because the ocean can support only so many fish, the total number of fish will " +
                "never exceed the original number of fish. Fishing can go on this way for many seasons, " +
                "but all fishing permanently ceases any time that all the fish are caught.\n\n" +
                "You can make money fishing. You will be paid $5 for every fish you catch. (For now, " +
                "this is 'play' money...but please treat it as if it were real money.)\n\n" +
                "Your job is to consider all these factors, and the other fishers, and make your own " +
                "decisions about how to fish. Fish however you wish.\n\n" +
                "Please ask if anything is unclear. We want you to fully understand the rules before you " +
                "start fishing.\n\n" +
                "If you are sure you understand all the above, you are ready to fish. Click on the Go " +
                "Fishing button on the left when you are ready. Once all the fishers have clicked this button, " +
                "the first season will begin. (You may have to wait briefly for all the others fishers " +
                "to click the button.)";
            this.depletedText = "All the fish are gone!";
            this.endText = "Seasons come and seasons go, but for now it seems we're done.";
            robotNames = new Array();
            robotNames[0] = "Leonardo";
            robotNames[1] = "Michelangelo";
            robotNames[2] = "Raphael";
            robotNames[3] = "Donatello";
            for (i = 0; i < this.expectedPlayers - this.expectedHumans; i++) {
                this.players[i] = new aiAgent(robotNames[i], 0.5, this.expectedPlayers, this.startingFish, this.actualMysteryFish, this.spawnFactor, this.chanceOfCatch);
                this.actualPlayers++;
            }
        }
        for (i = 1; i <= this.totalSeasons; i++) {
            this.seasonsData[i] = new seasonData(i);
        }
    }

    function allocateFisherToOcean(parent) {
        var availableOcean = "";
        for (i = 1; i <= parents[parent].numOceans; i++) {
            oID = parent + "-" + (1000 + i).toString().substr(1);
            if (oceans[oID].actualHumans < oceans[oID].expectedHumans) {
                availableOcean = oID;
                break;
            }
        }
        return availableOcean;
    }

    function recreateSimulationsList() {
        runningSims = "<ul>";
        for (parent in parents) {
            runningSims += "<li><b>" + parent + "</b>, with " + parents[parent].numOceans + " ocean(s).</li>";
        }
        runningSims += "</ul>"
    }

    io.sockets.on('connection', function (socket) {
        var oceanID = "";

        // Creating a group from newgroup.html
        socket.on('create group', function (gs) {
            console.log("Attempting to create group " + gs.name);
            if (gs.name in parents) {
                console.log("Group " + group + " already exists. No action taken.");
            } else {
                parents[gs.name] = new Parent(gs.name, gs.numOceans);
                recreateSimulationsList();
                for (ocean = 1; ocean <= gs.numOceans; ocean++) {
                    oceanID = gs.name + "-" + (1000 + ocean).toString().substr(1);
                    oceans[oceanID] = new gameParameters(gs, oceanID);
                    logs[oceanID] = new Date().toString() +  ", Simulation created from newgroup page.\n";
                }
                console.log("New group added, and parameters created: " + gs.name);
            }
        });

        // Responding to main.html
        var myID;
        socket.on('join group', function (group, pid) {
            if (group in parents) {
                console.log("Group " + group + " already exists; user joined.");
            } else {
                parents[group] = new Parent(group, 1);
                recreateSimulationsList();
                oceanID = group + "-001";
                oceans[oceanID] = new gameParameters(null, oceanID);
                logs[oceanID] = new Date().toString() +  ", Simulation created from fish page.\n";
                console.log("New group added, and parameters created: " + group);
            }
            io.sockets.in(oceanID).emit("join", "A player joined this group.");

            if (oceanID == "") {
                oceanID = allocateFisherToOcean(group);
            }

            socket.set('group', oceanID,
                function() {
                    socket.emit("myGroup", oceanID);
                }
            );
            socket.join(oceanID);

            oceans[oceanID].players[oceans[oceanID].actualPlayers] = new humanAgent(pid);
            logs[oceanID] += new Date().toString() + ", Fisher " + pid + " joined this simulation.\n";
            myID = oceans[oceanID].actualPlayers++;
            oceans[oceanID].actualHumans++;
            io.sockets.in(oceanID).emit("gamesettings", oceans[oceanID]);

            socket.set('gamesettings', oceans[oceanID],
                function() {
                    socket.emit('gamesettings', oceans[oceanID]);
                }
            );

            socket.set('myID', myID,
                function() {
                    socket.emit('myID', myID);
                }
            );

            socket.on('pauseRequest',
                function (data) {
                    console.log("A player requested to pause the simulation: " + data.id + ", gameroom " + oceanID + ".");
                    if ((oceans[oceanID].status == "running") || (oceans[oceanID].status == "resting")) {
                        oceans[oceanID].unpauseState = oceans[oceanID].status;
                        oceans[oceanID].status = "paused";
                        oceans[oceanID].pausedBy = data.id;
                        console.log("Simulation '" + oceanID + "' paused by player " + oceans[oceanID].players[data.id].name);
                        logs[oceanID] += new Date().toString() + ", Simulation paused by fisher " + oceans[oceanID].players[data.id].name + ".\n";
                        io.sockets.in(oceanID).emit("paused", {id: data.id});
                        io.sockets.in(oceanID).emit('gamesettings', oceans[oceanID]);
                    } else {
                        console.log("The simulation '" + oceanID + "' was not in a pausable state.");
                    }
                }
            );

            socket.on('resumeRequest',
                function (data) {
                    console.log("A player requested to resume the simulation: " + oceans[oceanID].players[data.id].name + ", gameroom " + oceanID + ".");
                    if (oceans[oceanID].status == "paused" && oceans[oceanID].pausedBy == data.id) {
                        oceans[oceanID].status = oceans[oceanID].unpauseState;
                        io.sockets.in(oceanID).emit("resumed", {id: data.id});
                        io.sockets.in(oceanID).emit('gamesettings', oceans[oceanID]);
                        logs[oceanID] += new Date().toString() + ", Simulation resumed by fisher " + oceans[oceanID].players[data.id].name + ".\n";
                    } else {
                        console.log("The simulation '" + oceanID + "' was not paused, or was paused by someone other than " + oceans[oceanID].players[data.id].name);
                    }
                }
            );

            socket.on('toSea',
                function (data) {
                    console.log("A player sailed to sea: " + oceans[oceanID].players[data.id].name + ", gameroom " + oceanID + ".");
                    logs[oceanID] += new Date().toString() + ", Fisher " + oceans[oceanID].players[data.id].name + " sailed to sea.\n";
                    oceans[oceanID].players[data.id].status = 'At sea';
                    oceans[oceanID].players[data.id].money -= oceans[oceanID].costDepart;
                    oceans[oceanID].players[data.id].endMoneyPerSeason[oceans[oceanID].currentSeason] = oceans[oceanID].players[data.id].money;
                    io.sockets.in(oceanID).emit('gamesettings', oceans[oceanID]);
                }
            );

            socket.on('toPort',
                function (data) {
                    console.log("A player returned to port: " + oceans[oceanID].players[data.id].name + ", gameroom " + oceanID + ".");
                    logs[oceanID] += new Date().toString() + ", Fisher " + oceans[oceanID].players[data.id].name + " returned to port.\n";
                    oceans[oceanID].players[data.id].status = 'At port';
                    io.sockets.in(oceanID).emit('gamesettings', oceans[oceanID]);
                }
            );

            socket.on('readRules',
                function(data) {
                    console.log("A player read the rules and is ready to start: " + oceans[oceanID].players[data.id].name + ", gameroom " + oceanID + ".");
                    logs[oceanID] += new Date().toString() + ", Fisher " + oceans[oceanID].players[data.id].name + " read the rules and is ready to start.\n";
                    oceans[oceanID].players[data.id].readRules = true;
                    allReadRules = true;
                    for (i = 0; i < oceans[oceanID].players.length; i++) {
                        if (oceans[oceanID].players[i].readRules == false) {
                            allReadRules = false;
                        }
                    }
                    if (oceans[oceanID].actualPlayers == oceans[oceanID].expectedPlayers && allReadRules) {
                        oceans[oceanID].status = 'readying';
                        oceans[oceanID].currentSeason = 1;
                        for (i = 0; i < oceans[oceanID].players.length; i++) {
                            oceans[oceanID].players[i].startMoneyPerSeason[1] = oceans[oceanID].players[i].startMoney;
                            oceans[oceanID].players[i].endMoneyPerSeason[1] = oceans[oceanID].players[i].startMoney;
                            oceans[oceanID].players[i].fishCaughtPerSeason[1] = 0;
                        }
                        io.sockets.in(oceanID).emit('gamesettings', oceans[oceanID]);
                        io.sockets.in(oceanID).emit('readying', 'All agents ready - prepare!');
                        logs[oceanID] += new Date().toString() + ", All fishers now ready to start.\n";
                    }
                }
            );

            socket.on('fishing',
                function (data) {
                    tryToFish(oceans[oceanID], oceanID, data.id, oceans[oceanID].players[data.id].name);
                    io.sockets.in(oceanID).emit('gamesettings', oceans[oceanID]);
                }
            );

            // Begin timekeeping
            if (beginTimer == false) {
                beginTimer = true;
                timer();
            }
        });
    });

    function individualRestraint(pool, numFishers, fishCaught) {
        return (pool - numFishers * fishCaught) / pool;
    }

    function groupRestraint(pool, endPool) {
        return endPool / pool;
    }

    function individualEfficiency(originalPool, startPool, spawnFactor, numFishers, fishCaught) {
        var ie;
        if (originalPool <= spawnFactor * startPool) {
            // Not endangered
            ie = (startPool - fishCaught * numFishers) * spawnFactor / originalPool;
        } else {
            // Endangered
            ie = (startPool - fishCaught * numFishers) / startPool;
        }
        return ie;
    }

    function groupEfficiency(originalPool, startPool, endPool, spawnFactor) {
        var ge;
        if (originalPool <= spawnFactor * startPool) {
            // Not endangered
            ge = endPool * spawnFactor / originalPool;
        } else {
            // Endangered - unclear if this is the proper interpretation
            ge = endPool / startPool;
        }
        return ge;
    }

    function logRun(g, name) {
        // Write a log of the results of the simulation run
        // g is the game object
        // r is the output string
        var currentTime = new Date();
        var r = "";
        var p;
        r += "FISH simulation log\n";
        r += "-------------------\n\n";

        r += "Run name: " + name + "\n";
        r += "Date and time: " + currentTime.toString() + "\n\n";

        r += "Number of agents: " + g.expectedPlayers + "\n";
        r += "Number of humans: " + g.expectedHumans + "\n";
        r += "Number of seasons: " + g.totalSeasons + "\n";
        r += "Season length (in seconds): " + g.seasonDuration + "\n";
        r += "Delay to begin simulation (in seconds): " + g.initialDelay + "\n";
        r += "Resting time between seasons (in seconds): " + g.restDuration + "\n";
        r += "Spawn factor: " + g.spawnFactor + "\n";
        r += "Chance of catch (0.00 to 1.00): " + g.chanceOfCatch + "\n";
        r += "Cost to depart: " + g.costDepart + "\n";
        r += "Cost per second at sea: " + g.costAtSea + "\n";
        r += "Cost to cast for a fish: " + g.costCast + "\n";
        r += "Value of fish caught: " + g.valueFish + "\n";
        r += "Number of starting certain fish: " + g.startingFish + "\n";
        r += "Number of starting mystery fish: " + g.startingMysteryFish + "\n";
        r += "Number of ending certain fish: " + g.certainFish + "\n";
        r += "Number of ending mystery fish: " + g.actualMysteryFish + "\n";
        r += "Showing other fishers' information?: " + (g.showOtherFishers ? "Yes" : "No") + "\n";
        r += "Showing other fishers' names?: " + (g.showFisherNames ? "Yes" : "No") + "\n";
        r += "Showing other fishers' status?: " + (g.showFisherStatus ? "Yes" : "No") + "\n";
        r += "Showing other fishers' number of fish caught?: " + (g.showFishCaught ? "Yes" : "No") + "\n";
        r += "Showing other fishers' money balance?: " + (g.showBalance ? "Yes" : "No") + "\n\n";

        r += "The following paragraphs were presented to participants as the preparation text:\n";
        r += "--------------------------------------------------------------------------------\n";
        r += g.prepText + "\n";
        r += "--------------------------------------------------------------------------------\n\n";

        r += "Measurements per fisher:\n\n";
        r += "Fisher, Type, Greed, Season, FishInit, FishTaken, Profit, IR, GR, IE, GE\n";
        r += "--------------------------------------------------------------------------------\n";
        for (i = 0; i < g.expectedPlayers; i++) {
            p = g.players[i];
            for (j = 1; j <= g.totalSeasons; j++) {
                r += p.name + ", ";
                r += p.type + ", ";
                r += ((p.type == "ai") ? p.greediness : "n/a") + ", ";
                r += j + ", ";
                r += g.seasonsData[j].initialFish + ", ";
                r += p.fishCaughtPerSeason[j] + ", ";
                r += (p.endMoneyPerSeason[j] - p.startMoneyPerSeason[j]) + ", ";
                r += individualRestraint(g.seasonsData[j].initialFish, g.expectedPlayers, p.fishCaughtPerSeason[j]) + ", ";
                r += groupRestraint(g.seasonsData[j].initialFish, g.seasonsData[j].endFish) + ", ";
                r += individualEfficiency(g.startingFish + g.startingMysteryFish, g.seasonsData[j].initialFish, g.spawnFactor, g.expectedPlayers, p.fishCaughtPerSeason[j]) + ", ";
                r += groupEfficiency(g.startingFish + g.startingMysteryFish, g.seasonsData[j].initialFish, g.seasonsData[j].endFish, g.spawnFactor) + "\n";
            }
        }
        r += "\n";
        r += "--------------------------------------------------------------------------------\n\n";

        r += "Logged simulation events:\n\n";
        r += logs[name];


        fs.writeFile("data/" + name + ".txt", r, function (err) {
            if (err) {
                return console.log(err);
            }
            console.log("Simulation run logged under data/" + name + ".txt");
        });

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
        }
    );

    if (engineCalled == false) {
        engineCalled = true;
        engine(io);
    }
}

function welcome(response, io) {
    console.log("Request handler 'welcome' was called.");
    fs.readFile(__dirname + '/index.html',
        function (err, data) {
            if (err) {
                response.writeHead(500);
                return response.end('Error loading index.html');
            }
            response.writeHead(200);
            response.end(data);
        }
    );
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
        }
    );

    if (engineCalled == false) {
        engineCalled = true;
        engine(io);
    }
}

function runningSimulationsList(response, io) {
    console.log("Request handler 'runningSimulationsList' was called.");
    if (engineCalled == false) {
        console.log("...but the simulation engine is not running!");
        response.writeHead(500);
        return response.end("Error trying to get list of running simulations.");
    } else {
        response.writeHead(200);
        response.end(runningSims);
    }
}

function newgroup(response, io) {
    console.log("Request handler 'newgroup' was called.");
    fs.readFile(__dirname + '/newgroup.html',
        function (err, data) {
            if (err) {
                response.writeHead(500);
                return response.end('Error loading newgroup.html');
            }
            response.writeHead(200);
            response.end(data);
        }
    );

    if (engineCalled == false) {
        engineCalled = true;
        engine(io);
    }
}

function certainfish(response, io) {
    console.log("Request handler 'certainfish' was called.");
    fs.readFile(__dirname + '/certain-fish.png',
        function (err, data) {
            if (err) {
                return response.end('Error loading certain-fish.png');
            }
            response.writeHead(200);
            response.end(data);
        }
    );
}

function mysteryfish(response, io) {
    console.log("Request handler 'mysteryfish' was called.");
    fs.readFile(__dirname + '/mystery-fish.png',
        function (err, data) {
            if (err) {
                return response.end('Error loading mystery-fish.png');
            }
            response.writeHead(200);
            response.end(data);
        }
    );
}

exports.fish = fish;
exports.welcome = welcome;
exports.mainadmin = mainadmin;
exports.runningSimulationsList = runningSimulationsList;
exports.newgroup = newgroup;
exports.certainfish = certainfish;
exports.mysteryfish = mysteryfish;
