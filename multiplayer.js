// BSS Multiplayer Client Module
// Syncs full player state: position, gear, bees, hive, tool animations, actions

const Multiplayer = (function() {

    let ws = null;
    let localId = null;
    let localColor = [1, 1, 1];
    let playerName = 'Player';
    let connected = false;
    let remotePlayers = {};
    let onChatCallback = null;
    let onStatusCallback = null;
    let onFlowerCallback = null;
    let onMobDmgCallback = null;
    let onSproutCallback = null;
    let sendCounter = 0;
    let gearSendCounter = 0;
    const SEND_RATE = 3; // Position: every 3 frames (~20/sec)
    const GEAR_SEND_RATE = 60; // Gear/hive: every 60 frames (~1/sec)

    function makePlayer(p) {
        return {
            id: p.id,
            name: p.name || 'Player ' + p.id,
            color: p.color || [1, 1, 1],
            x: p.x || 8, y: p.y || 2, z: p.z || 7,
            prevX: p.x || 8, prevY: p.y || 2, prevZ: p.z || 7,
            targetX: p.x || 8, targetY: p.y || 2, targetZ: p.z || 7,
            yaw: p.yaw || 0,
            targetYaw: p.yaw || 0,
            lerpT: 1,
            // Full gear
            currentGear: p.currentGear || {tool:'shovel',boots:'none',belt:'none',backpack:'pouch',mask:'none',leftGuard:'none',rightGuard:'none'},
            prevGearHash: '',
            gearDirty: true,
            // Meshes (created by game code)
            bodyMesh: null,
            toolMesh: null,
            // Tool animation
            toolRot: 0,
            toolSwinging: false,
            // Hive data: array of {type, gifted} for each slot
            hive: p.hive || [],
            hiveMesh: null,
            hiveDirty: true,
            // Bee data: array of {type, gifted, x, y, z} positions relative to player
            bees: p.bees || [],
            // Hive slot assignment (0, 1, 2...)
            hiveSlot: p.hiveSlot || -1,
        };
    }

    function connect(serverUrl, name) {
        if (ws) ws.close();
        playerName = (name || 'Player').substring(0, 20);
        remotePlayers = {};
        try { ws = new WebSocket(serverUrl); } catch (e) {
            if (onStatusCallback) onStatusCallback('Failed to connect');
            return;
        }
        if (onStatusCallback) onStatusCallback('Connecting...');

        ws.onopen = function() {
            connected = true;
            ws.send(JSON.stringify({ type: 'setname', name: playerName }));
            if (onStatusCallback) onStatusCallback('Connected');
        };
        ws.onmessage = function(event) {
            try { handleMessage(JSON.parse(event.data)); } catch (e) {}
        };
        ws.onclose = function() {
            connected = false;
            remotePlayers = {};
            if (onStatusCallback) onStatusCallback('Disconnected');
        };
        ws.onerror = function() {
            connected = false;
            if (onStatusCallback) onStatusCallback('Connection error');
        };
    }

    function disconnect() {
        if (ws) { ws.close(); ws = null; }
        connected = false;
        remotePlayers = {};
        localId = null;
    }

    function handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                localId = msg.id;
                localColor = msg.color;
                for (let i = 0; i < msg.players.length; i++)
                    remotePlayers[msg.players[i].id] = makePlayer(msg.players[i]);
                if (onStatusCallback) onStatusCallback('Connected as ' + playerName + ' (#' + localId + ')');
                break;

            case 'join':
                remotePlayers[msg.id] = makePlayer(msg);
                if (onChatCallback) onChatCallback(msg.name + ' joined the game', [50, 200, 50]);
                break;

            case 'leave':
                delete remotePlayers[msg.id];
                if (onChatCallback) onChatCallback('Player ' + msg.id + ' left the game', [200, 50, 50]);
                break;

            case 'name':
                if (remotePlayers[msg.id]) remotePlayers[msg.id].name = msg.name;
                break;

            case 'state':
                for (let i = 0; i < msg.players.length; i++) {
                    const p = msg.players[i];
                    if (p.id === localId) continue;
                    if (remotePlayers[p.id]) {
                        const rp = remotePlayers[p.id];
                        rp.prevX = rp.x; rp.prevY = rp.y; rp.prevZ = rp.z;
                        rp.targetX = p.x; rp.targetY = p.y; rp.targetZ = p.z;
                        rp.targetYaw = p.yaw;
                        rp.name = p.name || rp.name;
                        rp.color = p.color || rp.color;
                        rp.toolSwinging = p.toolSwinging || false;
                        rp.hiveSlot = p.hiveSlot !== undefined ? p.hiveSlot : rp.hiveSlot;
                        rp.lerpT = 0;
                        // Check if gear changed
                        if (p.currentGear) {
                            let newHash = JSON.stringify(p.currentGear);
                            if (newHash !== rp.prevGearHash) {
                                rp.currentGear = p.currentGear;
                                rp.prevGearHash = newHash;
                                rp.gearDirty = true;
                            }
                        }
                        // Update hive data
                        if (p.hive) {
                            rp.hive = p.hive;
                            rp.hiveDirty = true;
                        }
                        // Update bee data
                        if (p.bees) rp.bees = p.bees;
                    } else {
                        remotePlayers[p.id] = makePlayer(p);
                    }
                }
                break;

            case 'chat':
                if (onChatCallback) onChatCallback('<' + msg.name + '> ' + msg.text, [255, 255, 255]);
                break;

            case 'flower':
                if (onFlowerCallback) onFlowerCallback(msg);
                break;
            case 'mobdmg':
                if (onMobDmgCallback) onMobDmgCallback(msg);
                break;
            case 'sprout':
                if (onSproutCallback) onSproutCallback(msg);
                break;
            case 'error':
                if (onStatusCallback) onStatusCallback('Server: ' + msg.message);
                break;
        }
    }

    function interpolate(dt) {
        const lerpSpeed = 12;
        for (const id in remotePlayers) {
            const rp = remotePlayers[id];
            rp.lerpT = Math.min(rp.lerpT + dt * lerpSpeed, 1);
            const t = rp.lerpT;
            rp.x = rp.prevX + (rp.targetX - rp.prevX) * t;
            rp.y = rp.prevY + (rp.targetY - rp.prevY) * t;
            rp.z = rp.prevZ + (rp.targetZ - rp.prevZ) * t;
            let yawDiff = rp.targetYaw - rp.yaw;
            if (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
            if (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
            rp.yaw += yawDiff * Math.min(dt * lerpSpeed, 1);
            // Animate tool swing
            if (rp.toolSwinging) {
                rp.toolRot += dt * 10;
            } else {
                rp.toolRot = 0;
            }
        }
    }

    // Send position update (frequent)
    function sendUpdate(playerBody, playerYaw, currentGear, toolSwinging) {
        if (!connected || !ws || ws.readyState !== 1) return;
        sendCounter++;
        if (sendCounter % SEND_RATE !== 0) return;

        let msg = {
            type: 'update',
            x: Math.round(playerBody.position.x * 100) / 100,
            y: Math.round(playerBody.position.y * 100) / 100,
            z: Math.round(playerBody.position.z * 100) / 100,
            yaw: Math.round(playerYaw * 100) / 100,
            toolSwinging: !!toolSwinging,
        };

        // Send full gear less frequently
        gearSendCounter++;
        if (gearSendCounter % GEAR_SEND_RATE === 0 && currentGear) {
            msg.currentGear = {
                tool: currentGear.tool || 'shovel',
                boots: currentGear.boots || 'none',
                belt: currentGear.belt || 'none',
                backpack: currentGear.backpack || 'pouch',
                mask: currentGear.mask || 'none',
                leftGuard: currentGear.leftGuard || 'none',
                rightGuard: currentGear.rightGuard || 'none',
            };
        }

        ws.send(JSON.stringify(msg));
    }

    // Send hive and bee data (called infrequently)
    function sendHiveData(hiveData, beeData) {
        if (!connected || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({
            type: 'hivedata',
            hive: hiveData,
            bees: beeData,
        }));
    }

    function sendChat(text) {
        if (!connected || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: 'chat', text: text.substring(0, 200) }));
    }
    function sendFlowerUpdate(field, x, z, newHeight) {
        if (!connected || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: 'flower', field, x, z, h: Math.round(newHeight * 1000) / 1000 }));
    }
    function sendMobDamage(mobId, damage) {
        if (!connected || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: 'mobdmg', mobId, damage }));
    }
    function sendSproutSpawn(field, sproutType) {
        if (!connected || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: 'sprout', field, sproutType }));
    }

    return {
        connect, disconnect, sendUpdate, sendHiveData, sendChat, interpolate,
        sendFlowerUpdate, sendMobDamage, sendSproutSpawn,
        getRemotePlayers: function() { return remotePlayers; },
        isConnected: function() { return connected; },
        getLocalId: function() { return localId; },
        getLocalColor: function() { return localColor; },
        getPlayerCount: function() { return Object.keys(remotePlayers).length + (connected ? 1 : 0); },
        onChat: function(cb) { onChatCallback = cb; },
        onStatus: function(cb) { onStatusCallback = cb; },
        onFlower: function(cb) { onFlowerCallback = cb; },
        onMobDmg: function(cb) { onMobDmgCallback = cb; },
        onSprout: function(cb) { onSproutCallback = cb; },
    };
})();
