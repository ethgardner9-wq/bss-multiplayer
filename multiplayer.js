// BSS Multiplayer Client Module
// Handles WebSocket connection, sending local player state, and receiving remote players

const Multiplayer = (function() {

    let ws = null;
    let localId = null;
    let localColor = [1, 1, 1];
    let playerName = 'Player';
    let connected = false;
    let remotePlayers = {};
    let onChatCallback = null;
    let onStatusCallback = null;
    let sendCounter = 0;
    const SEND_RATE = 3; // Send every N frames (at 60fps = ~20 updates/sec)

    function connect(serverUrl, name) {
        if (ws) {
            ws.close();
        }

        playerName = (name || 'Player').substring(0, 20);
        remotePlayers = {};

        try {
            ws = new WebSocket(serverUrl);
        } catch (e) {
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
            try {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {}
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
        if (ws) {
            ws.close();
            ws = null;
        }
        connected = false;
        remotePlayers = {};
        localId = null;
    }

    function handleMessage(msg) {
        switch (msg.type) {
            case 'welcome':
                localId = msg.id;
                localColor = msg.color;
                // Add existing players
                for (let i = 0; i < msg.players.length; i++) {
                    const p = msg.players[i];
                    remotePlayers[p.id] = {
                        id: p.id,
                        name: p.name || 'Player ' + p.id,
                        color: p.color || [1, 1, 1],
                        x: p.x, y: p.y, z: p.z,
                        prevX: p.x, prevY: p.y, prevZ: p.z,
                        targetX: p.x, targetY: p.y, targetZ: p.z,
                        yaw: p.yaw || 0,
                        targetYaw: p.yaw || 0,
                        gear: p.gear || 'shovel',
                        mask: p.mask || 'none',
                        lerpT: 1,
                    };
                }
                if (onStatusCallback) onStatusCallback('Connected as ' + playerName + ' (#' + localId + ')');
                break;

            case 'join':
                remotePlayers[msg.id] = {
                    id: msg.id,
                    name: msg.name || 'Player ' + msg.id,
                    color: msg.color || [1, 1, 1],
                    x: msg.x, y: msg.y, z: msg.z,
                    prevX: msg.x, prevY: msg.y, prevZ: msg.z,
                    targetX: msg.x, targetY: msg.y, targetZ: msg.z,
                    yaw: msg.yaw || 0,
                    targetYaw: msg.yaw || 0,
                    gear: msg.gear || 'shovel',
                    mask: msg.mask || 'none',
                    lerpT: 1,
                };
                if (onChatCallback) onChatCallback(msg.name + ' joined the game', [50, 200, 50]);
                break;

            case 'leave':
                delete remotePlayers[msg.id];
                if (onChatCallback) onChatCallback('Player ' + msg.id + ' left the game', [200, 50, 50]);
                break;

            case 'name':
                if (remotePlayers[msg.id]) {
                    remotePlayers[msg.id].name = msg.name;
                }
                break;

            case 'state':
                // Full state update from server
                for (let i = 0; i < msg.players.length; i++) {
                    const p = msg.players[i];
                    if (p.id === localId) continue;

                    if (remotePlayers[p.id]) {
                        // Update existing - set interpolation targets
                        const rp = remotePlayers[p.id];
                        rp.prevX = rp.x;
                        rp.prevY = rp.y;
                        rp.prevZ = rp.z;
                        rp.targetX = p.x;
                        rp.targetY = p.y;
                        rp.targetZ = p.z;
                        rp.targetYaw = p.yaw;
                        rp.gear = p.gear || rp.gear;
                        rp.mask = p.mask || rp.mask;
                        rp.name = p.name || rp.name;
                        rp.color = p.color || rp.color;
                        rp.lerpT = 0;
                    } else {
                        // New player we haven't seen
                        remotePlayers[p.id] = {
                            id: p.id,
                            name: p.name || 'Player ' + p.id,
                            color: p.color || [1, 1, 1],
                            x: p.x, y: p.y, z: p.z,
                            prevX: p.x, prevY: p.y, prevZ: p.z,
                            targetX: p.x, targetY: p.y, targetZ: p.z,
                            yaw: p.yaw || 0,
                            targetYaw: p.yaw || 0,
                            gear: p.gear || 'shovel',
                            mask: p.mask || 'none',
                            lerpT: 1,
                        };
                    }
                }
                break;

            case 'chat':
                if (onChatCallback) {
                    onChatCallback('<' + msg.name + '> ' + msg.text, [255, 255, 255]);
                }
                break;

            case 'error':
                if (onStatusCallback) onStatusCallback('Server: ' + msg.message);
                break;
        }
    }

    // Interpolate remote players for smooth movement
    function interpolate(dt) {
        const lerpSpeed = 12; // How fast to interpolate (higher = snappier)
        for (const id in remotePlayers) {
            const rp = remotePlayers[id];
            rp.lerpT = Math.min(rp.lerpT + dt * lerpSpeed, 1);
            const t = rp.lerpT;

            rp.x = rp.prevX + (rp.targetX - rp.prevX) * t;
            rp.y = rp.prevY + (rp.targetY - rp.prevY) * t;
            rp.z = rp.prevZ + (rp.targetZ - rp.prevZ) * t;

            // Interpolate yaw (handle wrapping)
            let yawDiff = rp.targetYaw - rp.yaw;
            if (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
            if (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
            rp.yaw += yawDiff * Math.min(dt * lerpSpeed, 1);
        }
    }

    // Send local player state to server
    function sendUpdate(playerBody, playerYaw, currentGear) {
        if (!connected || !ws || ws.readyState !== 1) return;

        sendCounter++;
        if (sendCounter % SEND_RATE !== 0) return;

        ws.send(JSON.stringify({
            type: 'update',
            x: Math.round(playerBody.position.x * 100) / 100,
            y: Math.round(playerBody.position.y * 100) / 100,
            z: Math.round(playerBody.position.z * 100) / 100,
            yaw: Math.round(playerYaw * 100) / 100,
            gear: currentGear ? currentGear.tool : undefined,
            mask: currentGear ? currentGear.mask : undefined,
        }));
    }

    function sendChat(text) {
        if (!connected || !ws || ws.readyState !== 1) return;
        ws.send(JSON.stringify({ type: 'chat', text: text.substring(0, 200) }));
    }

    function getRemotePlayers() {
        return remotePlayers;
    }

    function isConnected() {
        return connected;
    }

    function getLocalId() {
        return localId;
    }

    function getLocalColor() {
        return localColor;
    }

    function onChat(callback) {
        onChatCallback = callback;
    }

    function onStatus(callback) {
        onStatusCallback = callback;
    }

    function getPlayerCount() {
        return Object.keys(remotePlayers).length + (connected ? 1 : 0);
    }

    return {
        connect,
        disconnect,
        sendUpdate,
        sendChat,
        interpolate,
        getRemotePlayers,
        isConnected,
        getLocalId,
        getLocalColor,
        getPlayerCount,
        onChat,
        onStatus,
    };

})();
