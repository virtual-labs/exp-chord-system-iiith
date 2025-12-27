        class ChordNode {
            constructor(id, m = 3) {
                this.id = id;
                this.m = m;
                this.successor = null;
                this.predecessor = null;
                this.fingerTable = new Array(m).fill(null);
                this.keys = new Set();
                
                // Enhanced features
                this.objectBucket = new Map(); // Store objects this node is responsible for
                this.fingerObjects = new Array(m).fill(null); // Closest object in each finger interval
                this.isCoordinator = false;

                this.status = 'active'; 
            }

            // Dual hash functions
            static fnv1a(str) {
                const FNV_PRIME = 0x01000193;
                const FNV_OFFSET = 0x811c9dc5;
                let hash = FNV_OFFSET;
                for (let i = 0; i < str.length; i++) {
                    hash ^= str.charCodeAt(i);
                    hash = Math.imul(hash, FNV_PRIME);
                }
                return hash >>> 0; // Convert to unsigned 32-bit
            }

            static hashNode(id) {
                // Use FNV-1a hash for node IDs
                return this.fnv1a(id.toString());
            }

            static hashObject(key, ringSize) {
                // Use FNV-1a hash for objects and map to ring size
                const hash = this.fnv1a(key.toString());
                return hash % ringSize;
            }

            findSuccessor(key, path = []) {
                // Add the current node to the path
                path.push(this);
                chord.incrementMessageCount();

                // Termination condition: If the key is between the current node and its successor,
                // the successor is the responsible node.
                if (this.successor && this.inRange(key, this.id, this.successor.id, true)) {
                    path.push(this.successor); // Add the final responsible node to the path
                    return { responsible: this.successor, path: path };
                } 
                
                // If not, find the best finger to forward the request to.
                let nextNode = this.closestPrecedingFinger(key);

                // If closestPrecedingFinger returns self, it means our successor is the next hop.
                // This is the crucial fix: we must forward the request instead of terminating.
                if (nextNode === this) {
                    nextNode = this.successor;
                }
                
                // Handle case where we might be in a single-node ring or at the end of a chain
                if (!nextNode || nextNode === this) {
                    path.push(this);
                    return { responsible: this, path: path };
                }

                // Recursively call findSuccessor on the next node in the path.
                return nextNode.findSuccessor(key, path);
            }


            // REPLACE the old closestPrecedingFinger method with this one.
            closestPrecedingFinger(key) {
                chord.incrementMessageCount();
                
                for (let i = this.m - 1; i >= 0; i--) {
                    if (this.fingerTable[i] && !this.fingerTable[i].isCrashed &&
                        this.inRange(this.fingerTable[i].id, this.id, key, false)) {
                        return this.fingerTable[i];
                    }
                }
                return this;
            }

            fixFingers() {
                const ringSize = Math.pow(2, this.m);
                
                for (let i = 0; i < this.m; i++) {
                    // Calculate the ID this finger should point to or succeed.
                    let fingerStart = (this.id + Math.pow(2, i)) % ringSize;
                    
                    // Use the network lookup to find the successor for the finger's start ID.
                    // We initiate the lookup from the current node itself.
                    const { responsible } = this.findSuccessor(fingerStart); 
                    this.fingerTable[i] = responsible;
                }
                
                // Update finger objects after the table is fixed.
                this.updateFingerObjectsAfterFix();
            }

            inRange(key, start, end, inclusive = false) {
                if (start === end) return inclusive;
                if (start < end) {
                    return inclusive ? key > start && key <= end : key > start && key < end;
                } else {
                    return inclusive ? key > start || key <= end : key > start || key < end;
                }
            }

            updateFingerObjectsAfterFix() {
                const ringSize = Math.pow(2, this.m);
                for (let i = 0; i < this.m; i++) {
                    let start = (this.id + Math.pow(2, i)) % ringSize;
                    // The end of the interval is the start of the next finger's interval.
                    let end = (this.id + Math.pow(2, (i + 1))) % ringSize;
                    
                    let closestObject = null;
                    let minDistance = Infinity;
                    
                    chord.objects.forEach((objectId, hashedKey) => {
                        if (this.inRange(hashedKey, start, end, false)) {
                            let distance = this.circularDistance(hashedKey, start, ringSize);
                            if (distance < minDistance) {
                                minDistance = distance;
                                closestObject = objectId;
                            }
                        }
                    });
                    this.fingerObjects[i] = closestObject;
                }
            }

            circularDistance(from, to, ringSize) {
               return (to - from + ringSize) % ringSize;
            }

            addObject(objectId, hashedKey) {
                this.objectBucket.set(hashedKey, objectId);
            }

            removeObject(hashedKey) {
                return this.objectBucket.delete(hashedKey);
            }

            hasObject(hashedKey) {
                if (this.isCrashed) return false;
                if (this.isByzantine && Math.random() < 0.3) {
                    // Byzantine node occasionally lies about having objects
                    return false;
                }
                return this.objectBucket.has(hashedKey);
            }

            getObject(hashedKey) {
                if (this.isCrashed) return null;
                if (this.isByzantine && Math.random() < 0.3) {
                    // Byzantine node occasionally returns wrong object
                    const objects = Array.from(this.objectBucket.values());
                    return objects.length > 0 ? objects[Math.floor(Math.random() * objects.length)] : null;
                }
                return this.objectBucket.get(hashedKey);
            }

            
        }

        class ChordRing {
            constructor(m = 3) {
                this.m = m;
                this.nodes = new Map();
                this.ringSize = Math.pow(2, m);
                this.showFingers = false;
                this.lookupHistory = [];
                this.hasPerformedLookup = false;
                this.hasRemovedNode = false;
                
                // Enhanced features
                this.objects = new Map(); // Map of hashedKey -> objectId
                this.objectCount = 5; // M random objects per round
                this.totalMessagesCount = 0;
                this.roundMessagesCount = 0;
                this.currentRound = 0;
                this.coordinator = null;
                this.faultMode = 'none'; // none, crash, byzantine
            }

            incrementMessageCount() {
                this.totalMessagesCount++;
                this.roundMessagesCount++;
            }

            startNewRound() {
                this.currentRound++;
                this.roundMessagesCount = 0;
                this.generateRandomObjects();
                this.assignCoordinator();
                this.distributeObjects();
                log(`Round ${this.currentRound} started - Generated ${this.objectCount} objects`, 'success');
            }

            generateRandomObjects() {
                this.objects.clear();
                
                // Use a temporary map to store the object data before assigning to nodes
                const tempObjects = new Map();

                for (let i = 0; i < this.objectCount; i++) {
                    // The object's visible number (0, 1, 2...) is now the actual key.
                    const objectKey = i.toString(); 

                    // The object's full ID for internal tracking.
                    const objectId = `obj_${this.currentRound}_${i}`;

                    // Hash the simple, predictable key.
                    const hashedKey = ChordNode.hashObject(objectKey, this.ringSize);

                    // Store the hashedKey -> objectId mapping.
                    // This is what will be distributed to nodes.
                    tempObjects.set(hashedKey, objectId);

                    log(`Generated object ${objectId} with key=${objectKey}, hash=${hashedKey}`, 'lookup');
                }

                // This map is now ready for distribution.
                this.objects = tempObjects;
                
                if (this.objects.size !== this.objectCount) {
                    log(`Warning: Generated ${this.objects.size} objects instead of ${this.objectCount} due to hash collisions. Try a larger ring size.`, 'message');
                }
            }

            assignCoordinator() {
                if (this.nodes.size === 0) return;
                
                const nodeIds = Array.from(this.nodes.keys());
                const coordinatorId = nodeIds[Math.floor(Math.random() * nodeIds.length)];
                
                // Reset previous coordinator
                if (this.coordinator) {
                    this.coordinator.isCoordinator = false;
                }
                
                this.coordinator = this.nodes.get(coordinatorId);
                this.coordinator.isCoordinator = true;
                log(`Node ${coordinatorId} designated as coordinator`, 'success');
            }

            distributeObjects() {
                this.objects.forEach((objectId, hashedKey) => {
                    const responsibleNode = this.findResponsibleNode(hashedKey);
                    if (responsibleNode) {
                        responsibleNode.addObject(objectId, hashedKey);
                        log(`Object ${objectId} assigned to Node ${responsibleNode.id}`, 'node');
                    }
                });
                
                // Update finger objects for all nodes
                log('Updating finger-object caches for all nodes...', 'node');
                this.nodes.forEach(node => {
                    if (!node.isCrashed) {
                        node.updateFingerObjectsAfterFix(); 
                    }
                });
            }

            findResponsibleNode(hashedKey) {
                if (this.nodes.size === 0) return null;
                
                // Find the first node whose ID is >= hashedKey, or wrap around to the smallest node
                const sortedNodes = Array.from(this.nodes.values())
                    .filter(node => !node.isCrashed)
                    .sort((a, b) => a.id - b.id);
                
                if (sortedNodes.length === 0) return null;
                
                // Find successor using Chord's key assignment rule
                for (let node of sortedNodes) {
                    if (node.id >= hashedKey) {
                        return node;
                    }
                }
                
                // If no node has ID >= hashedKey, the first node (smallest ID) is responsible
                return sortedNodes[0];
            }

            injectFault(nodeId, faultType) {
                const node = this.nodes.get(nodeId);
                if (!node) {
                    log(`Cannot inject fault: Node ${nodeId} not found`, 'message');
                    return false;
                }
                
                // Reset previous fault
                node.isCrashed = false;
                node.isByzantine = false;
                node.status = 'active';
                
                if (faultType === 'crash') {
                    node.isCrashed = true;
                    node.status = 'crashed';
                    log(`Crash fault injected into Node ${nodeId}`, 'message');
                } else if (faultType === 'byzantine') {
                    node.isByzantine = true;
                    node.status = 'byzantine';
                    log(`Byzantine fault injected into Node ${nodeId}`, 'message');
                }
                
                return true;
            }

            addNode(id) {
                if (this.nodes.has(id)) {
                    log(`Position ${id} is already occupied in the ring`, 'message');
                    return false;
                }

                const newNode = new ChordNode(id, this.m);
                
                if (this.nodes.size === 0) {
                    // This is the first node. It forms a ring by itself.
                    newNode.successor = newNode;
                    newNode.predecessor = newNode;
                    this.nodes.set(id, newNode);
                } else {
                    // Joining an existing ring. Get any active node to start the process.
                    const activeNodes = Array.from(this.nodes.values()).filter(n => !n.isCrashed);
                    if (activeNodes.length === 0) {
                        log("Cannot add node, all existing nodes are crashed.", "message");
                        return false;
                    }
                    const entryNode = activeNodes[0];

                    // 1. Ask the network to find the successor for the new node's ID.
                    const { responsible: successorNode } = entryNode.findSuccessor(id);
                    const predecessorNode = successorNode.predecessor;

                    // 2. Insert the new node into the list.
                    newNode.successor = successorNode;
                    newNode.predecessor = predecessorNode;
                    this.nodes.set(id, newNode);

                    // 3. Update the predecessor and successor to point to the new node.
                    predecessorNode.successor = newNode;
                    successorNode.predecessor = newNode;
                }

                log(`Node ${id} added, now updating finger tables...`, 'node');
                
                // 4. Update finger tables across the ring.
                this.updateAllFingerTables();

                log(`Ring stabilized with ${this.nodes.size} nodes`, 'success');
                return true;
            }


            removeNode(id) {
                if (!this.nodes.has(id)) {
                    log(`Node ${id} not found in the ring`, 'message');
                    return false;
                }

                const leavingNode = this.nodes.get(id);

                // If this is the last node, just clear the ring
                if (this.nodes.size === 1) {
                    this.clear();
                    updateVisualization();
                    return true;
                }

                const successor = leavingNode.successor;
                const predecessor = leavingNode.predecessor;

                // 1. Transfer any stored objects to the successor node.
                if (leavingNode.objectBucket.size > 0) {
                    log(`Transferring ${leavingNode.objectBucket.size} objects from Node ${id} to Node ${successor.id}`, 'node');
                    leavingNode.objectBucket.forEach((objectId, hashedKey) => {
                        successor.addObject(objectId, hashedKey);
                    });
                }

                // 2. "Stitch" the ring back together by updating the neighbors.
                predecessor.successor = successor;
                successor.predecessor = predecessor;
                
                // 3. Remove the node from the map.
                this.nodes.delete(id);
                this.hasRemovedNode = true;
                log(`Node ${id} removed from the ring`, 'node');
                
                // 4. A node leaving may invalidate other nodes' finger tables. Update them.
                this.updateAllFingerTables();
                
                log(`Ring stabilized after node removal`, 'success');
                return true;
            }


            updateAllFingerTables() {
                // This orchestrator function tells each node to fix its own fingers.
                // Each node will then use the network to do so independently.
                log('Updating all finger tables across the ring...', 'node');
                this.nodes.forEach(node => {
                    if (!node.isCrashed) {
                        node.fixFingers();
                    }
                });
            }

            lookup(key, startNodeId = null, isObjectLookup = false) {
    if (this.nodes.size === 0) {
        log('Cannot perform lookup: ring is empty', 'message');
        return { path: [], responsible: null, hops: 0, found: false, object: null };
    }

    this.hasPerformedLookup = true;
    this.roundMessagesCount = 0;

    const hashedKey = isObjectLookup ? ChordNode.hashObject(key, this.ringSize) : key;
    
    const activeNodes = Array.from(this.nodes.values()).filter(n => !n.isCrashed);
    if (activeNodes.length === 0) {
        log('All nodes are crashed!', 'message');
        return { path: [], responsible: null, hops: 0, found: false, object: null };
    }
    let startNode = startNodeId ? this.nodes.get(startNodeId) : activeNodes[0];
    if(startNode.isCrashed) startNode = activeNodes[0];
    
    log(`Starting lookup for ${isObjectLookup ? 'object' : 'key'} ${key} (hash=${hashedKey}) from node ${startNode.id}`, 'lookup');

    const { responsible, path } = startNode.findSuccessor(hashedKey);
    
    const hops = path.length > 1 ? path.length - 1 : 0;
    this.lookupHistory.push(hops);

    let found = false;
    let object = null;

    if (isObjectLookup && responsible) {
        // For object lookups, we need to check if the specific object exists
        const targetObjectId = `obj_${this.currentRound}_${key}`;
        const storedObject = responsible.getObject(hashedKey);
        found = storedObject === targetObjectId;
        
        if (found) {
            object = storedObject;
            log(`Object ${object} found at node ${responsible.id} in ${hops} hops`, 'success');
        } else {
            log(`Object ${key} not found at responsible node ${responsible.id}`, 'message');
        }
    } else if (responsible && !isObjectLookup) { // <-- THIS IS THE FIX!
        // This part is now ONLY for key lookups.
        log(`Key ${key} resolves to node ${responsible.id} in ${hops} hops`, 'success');
        found = true; // For key lookups, finding the node counts as success.
    }

    log(`Lookup completed: ${this.roundMessagesCount} messages sent this lookup`, 'lookup');

    return {
        path: path,
        responsible: responsible,
        hops: hops,
        found: found,
        object: object,
        messagesThisLookup: this.roundMessagesCount
    };
}

            circularDistance(from, to, ringSize) {
                let clockwise = (to - from + ringSize) % ringSize;
                return clockwise;
            }

            getAverageHops() {
                if (this.lookupHistory.length === 0) return 0;
                const sum = this.lookupHistory.reduce((a, b) => a + b, 0);
                return (sum / this.lookupHistory.length).toFixed(1);
            }

            checkChallenge() {
                if (this.currentChallenge < this.challenges.length) {
                    const challenge = this.challenges[this.currentChallenge];
                    if (challenge.check()) {
                        this.currentChallenge++;
                        this.updateChallengeDisplay();
                    }
                }
            }

            updateChallengeDisplay() {
                // Challenge display removed - method kept for compatibility
            }

            initializeNodes(count) {
                this.clear();
                
                // Generate evenly spaced IDs around the ring
                const spacing = Math.floor(this.ringSize / count);
                for (let i = 0; i < count; i++) {
                    const id = (i * spacing) % this.ringSize;
                    this.addNode(id);
                }
                
                // Assign one random node as coordinator
                const nodes = Array.from(this.nodes.values());
                const randomNode = nodes[Math.floor(Math.random() * nodes.length)];
                nodes.forEach(node => node.isCoordinator = false);
                randomNode.isCoordinator = true;
                this.coordinator = randomNode;
                
                log(`Initialized ${count} nodes with even spacing`, 'success');
            }

            clear() {
                this.nodes.clear();
                this.objects.clear();
                this.hasPerformedLookup = false;
                this.hasRemovedNode = false;
                this.lookupHistory = [];
                this.totalMessagesCount = 0;
                this.roundMessagesCount = 0;
                this.currentRound = 0;
                this.coordinator = null;
                log('Ring cleared - all nodes and objects removed', 'message');
            }

            setRingSize(m) {
                this.m = m;
                this.ringSize = Math.pow(2, m);
                log(`Ring size changed to ${this.ringSize} positions (2^${m})`, 'node');
                this.clear();
                
                // Update input max values
                document.getElementById('nodeId').max = this.ringSize - 1;
                document.getElementById('removeNodeId').max = this.ringSize - 1;
                document.getElementById('lookupKey').max = this.ringSize - 1;
                document.getElementById('faultNodeId').max = this.ringSize - 1;
                
                updateVisualization();
            }
        }

        const chord = new ChordRing(3);
        const svg = d3.select("#chordRing");
        let width, height, centerX, centerY, radius;

        function log(message, type = 'message') {
            const logsContainer = document.getElementById('logs');
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry ${type}`;
            logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            
            logsContainer.appendChild(logEntry);
            logsContainer.scrollTop = logsContainer.scrollHeight;

            // Keep only last 50 log entries
            while (logsContainer.children.length > 50) {
                logsContainer.removeChild(logsContainer.firstChild);
            }
        }

        function initVisualization() {
            const container = document.querySelector('.simulation-area');
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            
            // Calculate responsive dimensions with better padding for small screens
            const isMobile = window.innerWidth <= 768;
            const isSmallMobile = window.innerWidth <= 480;
            const isLandscape = window.innerWidth > window.innerHeight;
            
            let padding = 40;
            if (isMobile) padding = 20;
            if (isSmallMobile) padding = 15;
            
            width = containerWidth - padding;
            height = containerHeight - padding;
            
            // Ensure minimum dimensions
            width = Math.max(width, 250);
            height = Math.max(height, 250);
            
            centerX = width / 2;
            centerY = height / 2;
            
            // Calculate responsive radius with better margins for mobile
            let radiusMargin = 80;
            if (isMobile) radiusMargin = 50;
            if (isSmallMobile) radiusMargin = 40;
            
            radius = Math.min(width, height) / 2 - radiusMargin;
            radius = Math.max(radius, 80); // Minimum radius

            svg.attr("width", width).attr("height", height);
            svg.attr("viewBox", `0 0 ${width} ${height}`);
            svg.attr("preserveAspectRatio", "xMidYMid meet");
            
            updateVisualization();
        }
        
        // Get responsive node size based on screen dimensions
        function getResponsiveNodeSize() {
            const isMobile = window.innerWidth <= 768;
            const isSmallMobile = window.innerWidth <= 480;
            const isLandscape = window.innerWidth > window.innerHeight && window.innerHeight <= 500;
            
            if (isSmallMobile) return { base: 16, hover: 19, font: 11 };
            if (isMobile) return { base: 18, hover: 21, font: 12 };
            if (isLandscape) return { base: 18, hover: 21, font: 12 };
            return { base: 22, hover: 25, font: 14 };
        }
        
        // Get responsive font size for labels
        function getResponsiveFontSize() {
            const isMobile = window.innerWidth <= 768;
            const isSmallMobile = window.innerWidth <= 480;
            
            if (isSmallMobile) return 10;
            if (isMobile) return 12;
            return 14;
        }

        function updateVisualization() {
            svg.selectAll("*").remove();

            // Add gradients for enhanced visuals
            const defs = svg.append("defs");
            
            // Node gradient
            const nodeGradient = defs.append("radialGradient")
                .attr("id", "nodeGradient")
                .attr("cx", "30%")
                .attr("cy", "30%");
            nodeGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#60a5fa");
            nodeGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#3b82f6");

            // Active node gradient
            const activeGradient = defs.append("radialGradient")
                .attr("id", "activeGradient")
                .attr("cx", "30%")
                .attr("cy", "30%");
            activeGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#34d399");
            activeGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#10b981");

            // Highlight gradient
            const highlightGradient = defs.append("radialGradient")
                .attr("id", "highlightGradient")
                .attr("cx", "30%")
                .attr("cy", "30%");
            highlightGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#f87171");
            highlightGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#ef4444");

            // Finger table gradient
            const fingerGradient = defs.append("linearGradient")
                .attr("id", "fingerGradient");
            fingerGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#8b5cf6");
            fingerGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#a78bfa");

            // Successor gradient
            const successorGradient = defs.append("linearGradient")
                .attr("id", "successorGradient");
            successorGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#10b981");
            successorGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#34d399");

            // Coordinator gradient
            const coordinatorGradient = defs.append("radialGradient")
                .attr("id", "coordinatorGradient")
                .attr("cx", "30%")
                .attr("cy", "30%");
            coordinatorGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#fbbf24");
            coordinatorGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#f59e0b");

            // Crashed gradient
            const crashedGradient = defs.append("radialGradient")
                .attr("id", "crashedGradient")
                .attr("cx", "30%")
                .attr("cy", "30%");
            crashedGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#9ca3af");
            crashedGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#6b7280");

            // Byzantine gradient
            const byzantineGradient = defs.append("radialGradient")
                .attr("id", "byzantineGradient")
                .attr("cx", "30%")
                .attr("cy", "30%");
            byzantineGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#dc2626");
            byzantineGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#7c2d12");

            // Lookup path gradient
            const lookupGradient = defs.append("linearGradient")
                .attr("id", "lookupGradient");
            lookupGradient.append("stop")
                .attr("offset", "0%")
                .attr("stop-color", "#ef4444");
            lookupGradient.append("stop")
                .attr("offset", "100%")
                .attr("stop-color", "#f59e0b");

            // Draw ring circle with enhanced styling
            svg.append("circle")
                .attr("cx", centerX)
                .attr("cy", centerY)
                .attr("r", radius)
                .attr("fill", "none")
                .attr("stroke", "rgba(59, 130, 246, 0.3)")
                .attr("stroke-width", 3)
                .attr("stroke-dasharray", "15,8")
                .style("filter", "drop-shadow(0 0 10px rgba(59, 130, 246, 0.2))");

            // Draw ring positions with enhanced styling
            const labelFontSize = getResponsiveFontSize();
            for (let i = 0; i < chord.ringSize; i++) {
                const angle = (i * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);
                
                // Responsive position marker size
                const markerSize = window.innerWidth <= 480 ? 3 : 4;

                svg.append("circle")
                    .attr("cx", x)
                    .attr("cy", y)
                    .attr("r", markerSize)
                    .attr("fill", "rgba(59, 130, 246, 0.4)")
                    .style("filter", "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1))");
                
                // Responsive label offset
                const labelOffset = radius > 150 ? 25 : (radius > 100 ? 20 : 18);

                svg.append("text")
                    .attr("x", x + labelOffset * Math.cos(angle))
                    .attr("y", y + labelOffset * Math.sin(angle))
                    .attr("text-anchor", "middle")
                    .attr("dy", "0.35em")
                    .attr("font-size", `${labelFontSize}px`)
                    .attr("font-weight", "600")
                    .attr("fill", "#374151")
                    .style("text-shadow", "0 1px 2px rgba(255, 255, 255, 0.8)")
                    .text(i);
            }

            // Draw nodes with enhanced styling
            const nodeSize = getResponsiveNodeSize();
            chord.nodes.forEach((node, id) => {
                const angle = (id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);

                const nodeGroup = svg.append("g")
                    .attr("class", "node")
                    .attr("transform", `translate(${x}, ${y})`)
                    .style("cursor", "pointer")
                    .on("click", () => showNodeInfo(node))
                    .on("mouseenter", function() {
                        d3.select(this).select("circle")
                            .transition()
                            .duration(200)
                            .attr("r", nodeSize.hover);
                    })
                    .on("mouseleave", function() {
                        d3.select(this).select("circle")
                            .transition()
                            .duration(200)
                            .attr("r", nodeSize.base);
                    });

                // Determine node color based on status
                let nodeGradientId = "nodeGradient";
                let strokeColor = "rgba(59, 130, 246, 0.8)";
                let textColor = "white";
                
                if (node.isCrashed) {
                    nodeGradientId = "crashedGradient";
                    strokeColor = "rgba(107, 114, 128, 0.8)";
                    textColor = "#374151";
                } else if (node.isByzantine) {
                    nodeGradientId = "byzantineGradient";
                    strokeColor = "rgba(220, 38, 38, 0.8)";
                    textColor = "white";
                } else if (node.isCoordinator) {
                    nodeGradientId = "coordinatorGradient";
                    strokeColor = "rgba(245, 158, 11, 0.8)";
                    textColor = "#7c2d12";
                }

                // Node circle with status-based styling
                const nodeCircle = nodeGroup.append("circle")
                    .attr("class", "node-circle")
                    .attr("r", nodeSize.base)
                    .attr("fill", `url(#${nodeGradientId})`)
                    .attr("stroke", strokeColor)
                    .attr("stroke-width", window.innerWidth <= 480 ? 2 : 3)
                    .style("filter", "drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2))");

                // Add pulsing animation for coordinator
                if (node.isCoordinator) {
                    nodeCircle.style("animation", "nodePulse 2s infinite");
                }

                // Add dashed outline for faulty nodes
                if (node.isCrashed || node.isByzantine) {
                    nodeGroup.append("circle")
                        .attr("r", nodeSize.base + 5)
                        .attr("fill", "none")
                        .attr("stroke", strokeColor)
                        .attr("stroke-width", 2)
                        .attr("stroke-dasharray", "5,3")
                        .style("opacity", 0.6);
                }

                // Node text with status-appropriate styling
                nodeGroup.append("text")
                    .attr("text-anchor", "middle")
                    .attr("dy", "0.35em")
                    .attr("font-size", `${nodeSize.font}px`)
                    .attr("font-weight", "bold")
                    .attr("fill", textColor)
                    .style("text-shadow", node.isCrashed ? "none" : "0 1px 2px rgba(0, 0, 0, 0.5)")
                    .text(id);

                // Responsive indicator positioning
                const indicatorOffset = nodeSize.base + 10;
                const indicatorFontSize = window.innerWidth <= 480 ? "12px" : "14px";

                // Add status indicators
                if (node.isCoordinator) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", `-${indicatorOffset}px`)
                        .attr("font-size", indicatorFontSize)
                        .attr("fill", "#f59e0b")
                        .text("⭐");
                }

                if (node.isCrashed) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", `-${indicatorOffset}px`)
                        .attr("font-size", indicatorFontSize)
                        .attr("fill", "#ef4444")
                        .text("💥");
                }

                if (node.isByzantine) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", `-${indicatorOffset}px`)
                        .attr("font-size", indicatorFontSize)
                        .attr("fill", "#dc2626")
                        .text("🔥");
                }

                // Show object box if node has objects
                if (node.objectBucket.size > 0) {
                    // Create object box group - responsive positioning
                    const boxOffset = nodeSize.base + 8;
                    const boxGroup = nodeGroup.append("g")
                        .attr("transform", `translate(${boxOffset}, -15)`);
                    
                    // Responsive box sizing
                    const boxWidth = window.innerWidth <= 480 ? 50 : 60;
                    const lineHeight = window.innerWidth <= 480 ? 12 : 15;

                    // Box background
                    boxGroup.append("rect")
                        .attr("width", boxWidth)
                        .attr("height", node.objectBucket.size * lineHeight + 10)
                        .attr("rx", 4)
                        .attr("ry", 4)
                        .attr("fill", "#dcfce7")
                        .attr("stroke", "#059669")
                        .attr("stroke-width", 1)
                        .style("opacity", 0.9);

                    // List objects with responsive sizing
                    const objectFontSize = window.innerWidth <= 480 ? "9px" : "10px";
                    const objects = Array.from(node.objectBucket.values());
                    objects.forEach((objId, index) => {
                        boxGroup.append("text")
                            .attr("x", 5)
                            .attr("y", 15 + index * lineHeight)
                            .attr("font-size", objectFontSize)
                            .attr("fill", "#059669")
                            .text(`📦 ${objId.split('_')[2]}`); // Show just the object number
                    });
                }
            });

            // Draw successor links with enhanced curves
            chord.nodes.forEach((node, id) => {
                if (node.successor) {
                    const angle1 = (id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                    const angle2 = (node.successor.id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                    const x1 = centerX + radius * Math.cos(angle1);
                    const y1 = centerY + radius * Math.sin(angle1);
                    const x2 = centerX + radius * Math.cos(angle2);
                    const y2 = centerY + radius * Math.sin(angle2);

                    // Create smooth curved path
                    const midX = centerX + (radius * 0.7) * Math.cos((angle1 + angle2) / 2);
                    const midY = centerY + (radius * 0.7) * Math.sin((angle1 + angle2) / 2);

                    svg.append("path")
                        .attr("class", "successor-link")
                        .attr("d", `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`)
                        .attr("fill", "none")
                        .attr("marker-end", "url(#arrowhead)")
                        .style("opacity", 0)
                        .transition()
                        .duration(500)
                        .style("opacity", 0.9);
                }
            });

            // Add arrowhead marker
            defs.append("marker")
                .attr("id", "arrowhead")
                .attr("viewBox", "0 0 10 10")
                .attr("refX", 9)
                .attr("refY", 3)
                .attr("markerWidth", 6)
                .attr("markerHeight", 6)
                .attr("orient", "auto")
                .append("path")
                .attr("d", "M0,0 L0,6 L9,3 z")
                .attr("fill", "#10b981");

            // Draw finger tables if enabled
            if (chord.showFingers) {
                chord.nodes.forEach((node, id) => {
                    node.fingerTable.forEach((finger, i) => {
                        if (finger && node.successor && finger.id !== node.successor.id) {
                            const angle1 = (id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                            const angle2 = (finger.id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                            const x1 = centerX + radius * Math.cos(angle1);
                            const y1 = centerY + radius * Math.sin(angle1);
                            const x2 = centerX + radius * Math.cos(angle2);
                            const y2 = centerY + radius * Math.sin(angle2);

                            svg.append("line")
                                .attr("class", "finger-table")
                                .attr("x1", x1)
                                .attr("y1", y1)
                                .attr("x2", x2)
                                .attr("y2", y2);
                        }
                    });
                });
            }

            updateStats();
        }

        function updateStats() {
            document.getElementById('nodeCount').textContent = chord.nodes.size;
            document.getElementById('ringSize').textContent = chord.ringSize;
            document.getElementById('avgHops').textContent = chord.getAverageHops();
            
            // New statistics
            document.getElementById('objectsStored').textContent = chord.objects.size;
            document.getElementById('currentRound').textContent = chord.currentRound;
            document.getElementById('totalMessages').textContent = chord.totalMessagesCount;
            document.getElementById('roundMessages').textContent = chord.roundMessagesCount;
            document.getElementById('coordinator').textContent = chord.coordinator ? chord.coordinator.id : 'None';
            
            // Count faulty nodes
            let faultyCount = 0;
            chord.nodes.forEach(node => {
                if (node.isCrashed || node.isByzantine) faultyCount++;
            });
            document.getElementById('faultCount').textContent = faultyCount;
        }

        function showNodeInfo(node) {
            const info = document.getElementById('nodeInfo');
            let fingerInfo = node.fingerTable.map((finger, i) => {
                const start = (node.id + Math.pow(2, i)) % chord.ringSize;
                const end = (node.id + Math.pow(2, i + 1)) % chord.ringSize;
                const responsible = finger ? finger.id : 'N/A';
                const range = start === end ? `${start}` : `[${start}, ${end})`;
                const closestObj = node.fingerObjects[i] ? node.fingerObjects[i] : 'None';
                return `<div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(16,185,129,0.2);">
                    <span style="color: #065f46; font-weight: 600;">Finger ${i}:</span>
                    <span style="color: #064e3b;">${range} → Node ${responsible} (Obj: ${closestObj})</span>
                </div>`;
            }).join('');

            // Get stored objects
            const storedObjects = Array.from(node.objectBucket.entries()).map(([hash, objId]) => 
                `<div style="padding: 2px 0; color: #064e3b;">${objId} (hash: ${hash})</div>`
            ).join('');

            // Status styling
            let statusColor = '#065f46';
            let statusBg = 'rgba(16,185,129,0.1)';
            let statusBorder = 'rgba(16,185,129,0.2)';
            
            if (node.isCrashed) {
                statusColor = '#7f1d1d';
                statusBg = 'rgba(220,38,38,0.1)';
                statusBorder = 'rgba(220,38,38,0.2)';
            } else if (node.isByzantine) {
                statusColor = '#7c2d12';
                statusBg = 'rgba(194,65,12,0.1)';
                statusBorder = 'rgba(194,65,12,0.2)';
            } else if (node.isCoordinator) {
                statusColor = '#92400e';
                statusBg = 'rgba(245,158,11,0.1)';
                statusBorder = 'rgba(245,158,11,0.2)';
            }

            info.innerHTML = `
                <div class="node-info">
                    <h4 style="color: ${statusColor}; font-size: 1.2rem; margin-bottom: 15px; text-align: center; font-weight: 700;">
                        🔗 Node ${node.id} Details
                    </h4>
                    
                    <div style="text-align: center; padding: 8px; background: ${statusBg}; border-radius: 8px; border: 1px solid ${statusBorder}; margin-bottom: 15px;">
                        <div style="color: ${statusColor}; font-weight: bold; font-size: 0.9rem;">Status: ${node.status.toUpperCase()}</div>
                        ${node.isCoordinator ? '<div style="color: #92400e; font-size: 0.8rem;">⭐ COORDINATOR</div>' : ''}
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
                        <div style="text-align: center; padding: 8px; background: rgba(16,185,129,0.1); border-radius: 8px; border: 1px solid rgba(16,185,129,0.2);">
                            <div style="color: #065f46; font-weight: bold; font-size: 0.8rem;">Successor</div>
                            <div style="color: #064e3b; font-size: 1.1rem; font-weight: 600;">${node.successor ? node.successor.id : 'None'}</div>
                        </div>
                        <div style="text-align: center; padding: 8px; background: rgba(16,185,129,0.1); border-radius: 8px; border: 1px solid rgba(16,185,129,0.2);">
                            <div style="color: #065f46; font-weight: bold; font-size: 0.8rem;">Predecessor</div>
                            <div style="color: #064e3b; font-size: 1.1rem; font-weight: 600;">${node.predecessor ? node.predecessor.id : 'None'}</div>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 15px;">
                        <div style="color: #065f46; font-weight: bold; margin-bottom: 8px; font-size: 1rem;">📦 Stored Objects (${node.objectBucket.size}):</div>
                        <div style="font-size: 11px; background: rgba(16,185,129,0.05); padding: 10px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.1); max-height: 80px; overflow-y: auto;">
                            ${storedObjects || '<div style="color: #64748b; font-style: italic;">No objects stored</div>'}
                        </div>
                    </div>
                    
                    <div style="margin-top: 15px;">
                        <div style="color: #065f46; font-weight: bold; margin-bottom: 8px; font-size: 1rem;">📊 Finger Table:</div>
                        <div style="font-size: 11px; color: #064e3b; background: rgba(16,185,129,0.05); padding: 10px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.1); max-height: 120px; overflow-y: auto;">
                            ${fingerInfo}
                        </div>
                    </div>
                </div>
            `;
        }



        function removeNode() {
            const nodeId = parseInt(document.getElementById('removeNodeId').value);
            if (isNaN(nodeId)) {
                alert('Please enter a valid node ID');
                return;
            }

            if (chord.removeNode(nodeId)) {
                updateVisualization();
                document.getElementById('removeNodeId').value = '';
                document.getElementById('nodeInfo').innerHTML = '<p style="color: #6b7280;">Click on a node to see its details</p>';
            } else {
                alert('Node with ID ' + nodeId + ' does not exist!');
            }
        }

        function addRandomNode() {
            // Get all available positions in the ring
            const availableIds = [];
            for (let i = 0; i < chord.ringSize; i++) {
                if (!chord.nodes.has(i)) {
                    availableIds.push(i);
                }
            }

            if (availableIds.length === 0) {
                alert('All positions in the ring are occupied!');
                return;
            }

            // Pick a random available position
            const randomIndex = Math.floor(Math.random() * availableIds.length);
            const selectedId = availableIds[randomIndex];
            
            // Add node at the selected position
            chord.addNode(selectedId);
            updateVisualization();
            updateStats();
        }

        function performLookup() {
            const key = parseInt(document.getElementById('lookupKey').value);
            if (isNaN(key) || key < 0 || key >= chord.ringSize) {
                alert('Please enter a valid key between 0 and ' + (chord.ringSize - 1));
                return;
            }

            if (chord.nodes.size === 0) {
                alert('Add some nodes first!');
                return;
            }

            const result = chord.lookup(key);
            const resultDiv = document.getElementById('lookupResult');
            
            if (result.path.length > 0) {
                const pathStr = result.path.map(node => node.id).join(' → ');
                resultDiv.innerHTML = `
                    <div class="lookup-result">
                        <h4 style="color: #92400e; font-size: 1.1rem; margin-bottom: 10px; font-weight: 600;">
                            🔍 Key ${key} Lookup Result
                        </h4>
                        <div style="color: #451a03;">
                            <strong>Path:</strong> ${pathStr}<br>
                            <strong>Responsible Node:</strong> ${result.responsible.id}<br>
                            <strong>Hops:</strong> ${result.hops}
                        </div>
                    </div>
                `;
                
                document.getElementById('lookupHops').textContent = result.hops;
                updateStats();
            } else {
                resultDiv.innerHTML = '<div class="lookup-result"><strong>No path found</strong></div>';
            }

            // Animate the lookup path
            animateLookupPath(result.path);
        }

        // New enhanced functions
        function performObjectLookup() {
            const key = document.getElementById('objectLookupKey').value;
            if (key === '' || isNaN(parseInt(key))) {
                alert('Please enter a valid object number to look up.');
                return;
            }

            if (chord.nodes.size === 0) {
                alert('Add some nodes first!');
                return;
            }

            // THIS IS THE CORRECT WAY TO CALL THE LOOKUP:
            // We pass the user's raw input (e.g., "100") and the 'true' flag.
            // The `lookup` function will now handle hashing AND checking the node's bucket.
            const result = chord.lookup(key, null, true);
            
            const resultDiv = document.getElementById('lookupResult');
            
            // Now we can trust the 'result.found' value completely because the main lookup function gave it to us.
            if (result.path.length > 0) {
                const pathStr = result.path.map(node => node ? node.id : 'N/A').join(' → ');
                const statusColor = result.found ? '#059669' : '#dc2626'; // Green if found, Red if not
                const statusText = result.found ? 'Found' : 'Not Found';
                
                resultDiv.innerHTML = `
                    <div class="lookup-result">
                        <h4 style="color: #92400e; font-size: 1.1rem; margin-bottom: 10px; font-weight: 600;">
                            🎯 Object ${key} Lookup Result
                        </h4>
                        <div style="color: #451a03;">
                            <strong>Status:</strong> <span style="color: ${statusColor}; font-weight: bold;">${statusText}</span><br>
                            <strong>Hash:</strong> ${ChordNode.hashObject(key, chord.ringSize)}<br>
                            <strong>Path:</strong> ${pathStr}<br>
                            <strong>Responsible Node:</strong> ${result.responsible ? result.responsible.id : 'N/A'}<br>
                            <strong>Hops:</strong> ${result.hops}<br>
                            <strong>Messages:</strong> ${result.messagesThisLookup}<br>
                            ${result.object ? `<strong>Object ID:</strong> ${result.object}` : ''}
                        </div>
                    </div>
                `;
                
                document.getElementById('lookupHops').textContent = result.hops;
                updateStats();
            } else {
                resultDiv.innerHTML = '<div class="lookup-result"><strong>No path found</strong></div>';
            }

            // Animate the lookup path
            animateLookupPath(result.path);
        }

        function startNewRound() {
            const objectCount = parseInt(document.getElementById('objectCount').value);
            chord.objectCount = objectCount;
            
            // Clear existing objects from all nodes
            chord.nodes.forEach(node => {
                node.objectBucket.clear();
            });
            
            chord.startNewRound();
            updateVisualization();
            updateStats();
            
            log(`New round started with ${objectCount} objects`, 'success');
        }

        // Mobile scroll helper function
        function scrollToSection(section) {
            const fab = document.getElementById('fabScroll');
            let targetElement;
            
            if (section === 'experiment') {
                targetElement = document.querySelector('.experiment-area');
                fab.textContent = '📋';
                fab.setAttribute('onclick', "scrollToSection('controls')");
                fab.setAttribute('title', 'View Controls');
            } else if (section === 'controls') {
                targetElement = document.querySelector('.controls-panel');
                fab.textContent = '📊';
                fab.setAttribute('onclick', "scrollToSection('stats')");
                fab.setAttribute('title', 'View Statistics');
            } else if (section === 'stats') {
                targetElement = document.querySelector('.observations-panel');
                fab.textContent = '🔗';
                fab.setAttribute('onclick', "scrollToSection('experiment')");
                fab.setAttribute('title', 'View Ring');
            }
            
            if (targetElement) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
        
        // Make scroll function globally available
        window.scrollToSection = scrollToSection;

        function showFingerTables() {
            chord.showFingers = true;
            log('Finger tables visualization enabled', 'node');
            updateVisualization();
        }

        function hideFingerTables() {
            chord.showFingers = false;
            log('Finger tables visualization disabled', 'node');
            updateVisualization();
        }

        function clearRing() {
            chord.clear();
            updateVisualization();
            document.getElementById('nodeInfo').innerHTML = '<p style="color: #6b7280;">Click on a node to see its details</p>';
            document.getElementById('lookupResult').innerHTML = '<p style="color: #6b7280;">Perform a lookup to see results</p>';
            document.getElementById('lookupHops').textContent = '0';
            updateStats();
        }

        /* Demo function removed - no longer used
        function startDemo() {
            clearRing();
            
            // Add nodes sequentially with delays
            const nodesToAdd = [0, 2, 4, 6];
            nodesToAdd.forEach((nodeId, index) => {
                setTimeout(() => {
                    chord.addNode(nodeId);
                    updateVisualization();
                    
                    if (index === nodesToAdd.length - 1) {
                        setTimeout(() => {
                            chord.showFingers = true;
                            updateVisualization();
                            
                            setTimeout(() => {
                                document.getElementById('lookupKey').value = 3;
                                performLookup();
                            }, 1000);
                        }, 1000);
                    }
                }, index * 1000);
            });
        }
        */

        // Ring size change handler
        document.getElementById('ringSizeSelect').addEventListener('change', (e) => {
            const newM = parseInt(e.target.value);
            chord.setRingSize(newM);
            updateVisualization();
        });
        
        // Collapsible sections for mobile
        function setupCollapsibleSections() {
            // Control sections
            const controlSections = document.querySelectorAll('.control-section');
            controlSections.forEach(section => {
                const header = section.querySelector('h3');
                if (header) {
                    header.addEventListener('click', (e) => {
                        if (window.innerWidth <= 768) {
                            e.preventDefault();
                            section.classList.toggle('collapsed');
                        }
                    });
                }
            });
            
            // Status sections
            const statusSections = document.querySelectorAll('.status-section');
            statusSections.forEach(section => {
                const header = section.querySelector('h4');
                if (header) {
                    header.addEventListener('click', (e) => {
                        if (window.innerWidth <= 768) {
                            e.preventDefault();
                            section.classList.toggle('collapsed');
                        }
                    });
                }
            });
        }

        // Initialize the visualization when the page loads
        window.addEventListener('load', () => {
            initVisualization();
            setupCollapsibleSections();
            log('Chord DHT simulation ready', 'success');
            
            // Debug the objectCount dropdown
            const objectCountSelect = document.getElementById('objectCount');
            console.log('ObjectCount dropdown found:', objectCountSelect);
            console.log('ObjectCount innerHTML:', objectCountSelect.innerHTML);
            console.log('ObjectCount outerHTML:', objectCountSelect.outerHTML);
            console.log('ObjectCount dropdown options:', objectCountSelect.options.length);
            
            // Check if options exist in DOM
            const allOptions = objectCountSelect.querySelectorAll('option');
            console.log('Options found via querySelectorAll:', allOptions.length);
            allOptions.forEach((option, index) => {
                console.log(`Option ${index}:`, option.value, option.textContent);
            });
            
            // Try to manually add options if they're missing
            if (objectCountSelect.options.length === 0) {
                console.log('No options found! Adding them manually...');
                objectCountSelect.innerHTML = `
                    <option value="3">3 objects</option>
                    <option value="5" selected>5 objects</option>
                    <option value="8">8 objects</option>
                    <option value="10">10 objects</option>
                `;
                console.log('Options added. New count:', objectCountSelect.options.length);
            }
            
            // Add event listeners for debugging
            objectCountSelect.addEventListener('click', (e) => {
                console.log('ObjectCount dropdown clicked');
                console.log('Dropdown size:', objectCountSelect.size);
                console.log('Dropdown multiple:', objectCountSelect.multiple);
            });
            
            objectCountSelect.addEventListener('mousedown', (e) => {
                console.log('ObjectCount dropdown mousedown');
            });
            
            objectCountSelect.addEventListener('focus', (e) => {
                console.log('ObjectCount dropdown focused');
            });
            
            objectCountSelect.addEventListener('change', (e) => {
                console.log('ObjectCount dropdown changed to:', e.target.value);
            });
        });

        // Handle window resize with debouncing
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                initVisualization();
            }, 150);
        });
        
        // Handle orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                initVisualization();
            }, 200);
        });

        // Debug function for dropdown - call this from console if needed
        function debugDropdown() {
            const dropdown = document.getElementById('objectCount');
            console.log('=== DROPDOWN DEBUG ===');
            console.log('Element:', dropdown);
            console.log('Parent:', dropdown.parentElement);
            console.log('Computed style:', window.getComputedStyle(dropdown));
            console.log('BoundingRect:', dropdown.getBoundingClientRect());
            console.log('Options count:', dropdown.options.length);
            console.log('Current value:', dropdown.value);
            console.log('Size attribute:', dropdown.size);
            console.log('Multiple attribute:', dropdown.multiple);
            console.log('Disabled:', dropdown.disabled);
            
            // Try to programmatically open it
            dropdown.focus();
            dropdown.click();
        }

        // Make debugDropdown available globally
        window.debugDropdown = debugDropdown;

        // Info modal functions
        function toggleInfoModal() {
            const modal = document.getElementById('infoModal');
            if (modal.classList.contains('show')) {
                closeInfoModal();
            } else {
                openInfoModal();
            }
        }

        function openInfoModal() {
            const modal = document.getElementById('infoModal');
            modal.classList.add('show');
            document.body.style.overflow = 'hidden'; // Prevent background scrolling
        }

        function closeInfoModal(event) {
            // Close if clicked outside the modal content or on close button
            if (!event || event.target === document.getElementById('infoModal') || event.target.classList.contains('close-button')) {
                const modal = document.getElementById('infoModal');
                modal.classList.remove('show');
                document.body.style.overflow = ''; // Restore scrolling
            }
        }

        // Make modal functions globally available
        window.toggleInfoModal = toggleInfoModal;
        window.openInfoModal = openInfoModal;
        window.closeInfoModal = closeInfoModal;

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Close modal with Escape key
            if (e.key === 'Escape') {
                closeInfoModal();
                return;
            }
            
            // Info modal shortcut
            if (e.key === 'F1' || (e.ctrlKey && e.key === 'h')) {
                e.preventDefault();
                toggleInfoModal();
                return;
            }
            
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'n':
                        e.preventDefault();
                        addRandomNode();
                        break;
                    case 'f':
                        e.preventDefault();
                        if (chord.showFingers) {
                            hideFingerTables();
                        } else {
                            showFingerTables();
                        }
                        break;
                    case 'l':
                        e.preventDefault();
                        document.getElementById('lookupKey').focus();
                        break;
                    case 'r':
                        e.preventDefault();
                        clearRing();
                        break;
                }
            }
        });

        // Mobile orientation handling - now fully responsive, overlay disabled
        function checkOrientation() {
            // Overlay is now hidden via CSS as the layout is fully responsive
            // This function is kept for potential future use or analytics
            const isMobile = window.innerWidth < 768;
            const isPortrait = window.innerHeight > window.innerWidth;
            
            // Just reinitialize visualization on orientation change
            if (isMobile) {
                initVisualization();
            }
        }

        // Check orientation on load and resize
        window.addEventListener('load', checkOrientation);
        window.addEventListener('orientationchange', () => {
            setTimeout(checkOrientation, 100);
        });