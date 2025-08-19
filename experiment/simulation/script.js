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
                this.status = 'active'; // active, crashed, byzantine
                this.isCrashed = false;
                this.isByzantine = false;
                this.isCoordinator = false;
            }

            // Dual hash functions
            static hashNode(id) {
                // Simple hash function for node placement
                return id; // For now, direct mapping, can be enhanced
            }

            static hashObject(key, ringSize = 8) {
                // Hash function for object placement - different from node hash
                return (key * 7 + 3) % ringSize; // Use dynamic ring size
            }

            findSuccessor(key, isLookup = false) {
                // Enhanced with fault injection
                if (this.isCrashed) {
                    if (isLookup) {
                        chord.incrementMessageCount();
                        return null; // Crashed node doesn't respond
                    }
                }
                
                if (this.isByzantine && Math.random() < 0.3) {
                    chord.incrementMessageCount();
                    // Byzantine behavior: return wrong successor occasionally
                    const nodes = Array.from(chord.nodes.values());
                    return nodes[Math.floor(Math.random() * nodes.length)];
                }

                chord.incrementMessageCount();
                
                if (this.inRange(key, this.id, this.successor.id, true)) {
                    return this.successor;
                }
                let node = this.closestPrecedingFinger(key);
                if (node === this) {
                    return this.successor;
                }
                return node.findSuccessor(key, isLookup);
            }

            closestPrecedingFinger(key) {
                chord.incrementMessageCount();
                
                for (let i = this.m - 1; i >= 0; i--) {
                    if (this.fingerTable[i] && 
                        this.inRange(this.fingerTable[i].id, this.id, key, false)) {
                        return this.fingerTable[i];
                    }
                }
                return this;
            }

            inRange(key, start, end, inclusive = false) {
                if (start === end) return inclusive;
                if (start < end) {
                    return inclusive ? key > start && key <= end : key > start && key < end;
                } else {
                    return inclusive ? key > start || key <= end : key > start || key < end;
                }
            }

            updateFingerTable(nodes) {
                const ringSize = Math.pow(2, this.m);
                for (let i = 0; i < this.m; i++) {
                    let target = (this.id + Math.pow(2, i)) % ringSize;
                    this.fingerTable[i] = this.findSuccessorInNodeList(target, nodes);
                    
                    // Update finger objects - find closest object in this interval
                    this.updateFingerObject(i, target, ringSize);
                }
            }

            updateFingerObject(fingerIndex, target, ringSize) {
                let start = (this.id + Math.pow(2, fingerIndex)) % ringSize;
                let end = fingerIndex < this.m - 1 ? 
                    (this.id + Math.pow(2, fingerIndex + 1)) % ringSize : 
                    this.id;
                
                let closestObject = null;
                let minDistance = ringSize;
                
                // Search through all objects in the ring
                chord.objects.forEach((objectId, hashedKey) => {
                    if (this.inRange(hashedKey, start, end, false)) {
                        let distance = this.circularDistance(hashedKey, target, ringSize);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestObject = objectId;
                        }
                    }
                });
                
                this.fingerObjects[fingerIndex] = closestObject;
            }

            circularDistance(from, to, ringSize) {
                let clockwise = (to - from + ringSize) % ringSize;
                let counterclockwise = (from - to + ringSize) % ringSize;
                return Math.min(clockwise, counterclockwise);
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

            findSuccessorInNodeList(key, nodes) {
                let sortedNodes = nodes.sort((a, b) => a.id - b.id);
                for (let node of sortedNodes) {
                    if (node.id >= key) {
                        return node;
                    }
                }
                return sortedNodes[0];
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
                
                for (let i = 0; i < this.objectCount; i++) {
                    const objectId = `obj_${this.currentRound}_${i}`;
                    const rawKey = Math.floor(Math.random() * 1000); // Random key
                    const hashedKey = ChordNode.hashObject(rawKey, this.ringSize);
                    
                    this.objects.set(hashedKey, objectId);
                    log(`Generated object ${objectId} with key=${rawKey}, hash=${hashedKey}`, 'lookup');
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
                this.nodes.forEach(node => {
                    if (!node.isCrashed) {
                        node.updateFingerTable(Array.from(this.nodes.values()));
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
                    log(`Node ${id} already exists in the ring`, 'message');
                    return false;
                }

                const hashedId = ChordNode.hashNode(id) % this.ringSize;
                const node = new ChordNode(hashedId, this.m);
                node.originalId = id; // Keep track of original ID
                this.nodes.set(hashedId, node);
                log(`Node ${id} (hashed to ${hashedId}) added to the ring`, 'node');
                
                this.stabilizeRing();
                this.updateFingerTables();
                log(`Ring stabilized with ${this.nodes.size} nodes`, 'success');
                
                return true;
            }

            removeNode(id) {
                if (!this.nodes.has(id)) {
                    log(`Node ${id} not found in the ring`, 'message');
                    return false;
                }

                this.nodes.delete(id);
                this.hasRemovedNode = true;
                log(`Node ${id} removed from the ring`, 'node');
                
                this.stabilizeRing();
                this.updateFingerTables();
                log(`Ring stabilized after node removal`, 'success');
                
                return true;
            }

            stabilizeRing() {
                const nodeArray = Array.from(this.nodes.values()).sort((a, b) => a.id - b.id);
                
                for (let i = 0; i < nodeArray.length; i++) {
                    const current = nodeArray[i];
                    const next = nodeArray[(i + 1) % nodeArray.length];
                    const prev = nodeArray[(i - 1 + nodeArray.length) % nodeArray.length];
                    
                    current.successor = next;
                    current.predecessor = prev;
                }
            }

            updateFingerTables() {
                const nodeArray = Array.from(this.nodes.values());
                nodeArray.forEach(node => {
                    node.updateFingerTable(nodeArray);
                });
            }

            lookup(key, startNodeId = null, isObjectLookup = false) {
                if (this.nodes.size === 0) {
                    log('Cannot perform lookup: ring is empty', 'message');
                    return { path: [], responsible: null, hops: 0, found: false, object: null };
                }

                this.hasPerformedLookup = true;
                this.roundMessagesCount = 0; // Reset round message count

                const hashedKey = isObjectLookup ? ChordNode.hashObject(key, this.ringSize) : key;
                let startNode = startNodeId ? this.nodes.get(startNodeId) : Array.from(this.nodes.values())[0];
                
                // Ensure start node is not crashed
                if (startNode && startNode.isCrashed) {
                    const activeNodes = Array.from(this.nodes.values()).filter(n => !n.isCrashed);
                    if (activeNodes.length === 0) {
                        log('All nodes are crashed!', 'message');
                        return { path: [], responsible: null, hops: 0, found: false, object: null };
                    }
                    startNode = activeNodes[0];
                }
                
                let path = [startNode];
                let current = startNode;

                log(`Starting lookup for ${isObjectLookup ? 'object' : 'key'} ${key} (hash=${hashedKey}) from node ${startNode.id}`, 'lookup');

                // Enhanced lookup with fault tolerance
                let maxIterations = 10; // Prevent infinite loops
                while (maxIterations > 0 && !current.inRange(hashedKey, current.id, current.successor?.id || current.id, true)) {
                    let next = current.closestPrecedingFinger(hashedKey);
                    if (next === current || next.isCrashed) {
                        next = current.successor;
                    }
                    
                    // Handle crashed nodes in path - find closest active successor
                    if (next && next.isCrashed) {
                        log(`Node ${next.id} is crashed, finding alternate route`, 'message');
                        const activeNodes = Array.from(this.nodes.values()).filter(n => !n.isCrashed);
                        if (activeNodes.length === 0) {
                            log('All nodes are crashed!', 'message');
                            break;
                        }
                        // Find closest active node in the direction of the key
                        next = activeNodes.reduce((closest, node) => {
                            const currentDistance = this.circularDistance(current.id, hashedKey, this.ringSize);
                            const nodeDistance = this.circularDistance(node.id, hashedKey, this.ringSize);
                            return nodeDistance < currentDistance ? node : closest;
                        }, activeNodes[0]);
                    }
                    
                    if (!next || next === current) break;
                    
                    path.push(next);
                    log(`Routing from node ${current.id} to node ${next.id}`, 'lookup');
                    current = next;
                    maxIterations--;
                }

                const hops = path.length - 1;
                this.lookupHistory.push(hops);

                // Determine responsible node and check for object
                const responsibleNode = current.successor || current;
                let found = false;
                let object = null;

                if (isObjectLookup && responsibleNode) {
                    found = responsibleNode.hasObject(hashedKey);
                    if (found) {
                        object = responsibleNode.getObject(hashedKey);
                        log(`Object ${object} found at node ${responsibleNode.id} in ${hops} hops`, 'success');
                    } else {
                        if (responsibleNode.isCrashed) {
                            log(`Object lookup failed: responsible node ${responsibleNode.id} is crashed`, 'message');
                        } else if (responsibleNode.isByzantine) {
                            log(`Object lookup may be compromised: responsible node ${responsibleNode.id} is Byzantine`, 'message');
                        } else {
                            log(`Object not found at responsible node ${responsibleNode.id}`, 'message');
                        }
                    }
                } else {
                    log(`Key ${key} resolves to node ${responsibleNode.id} in ${hops} hops`, 'success');
                    found = true; // For key lookups, finding the responsible node counts as success
                }

                log(`Lookup completed: ${this.roundMessagesCount} messages sent this lookup`, 'lookup');

                return {
                    path: path,
                    responsible: responsibleNode,
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
            width = container.clientWidth - 40;
            height = container.clientHeight - 40;
            centerX = width / 2;
            centerY = height / 2;
            radius = Math.min(width, height) / 2 - 80;

            svg.attr("width", width).attr("height", height);
            updateVisualization();
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
            for (let i = 0; i < chord.ringSize; i++) {
                const angle = (i * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);

                svg.append("circle")
                    .attr("cx", x)
                    .attr("cy", y)
                    .attr("r", 4)
                    .attr("fill", "rgba(59, 130, 246, 0.4)")
                    .style("filter", "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1))");

                svg.append("text")
                    .attr("x", x + (radius > 150 ? 25 : 20) * Math.cos(angle))
                    .attr("y", y + (radius > 150 ? 25 : 20) * Math.sin(angle))
                    .attr("text-anchor", "middle")
                    .attr("dy", "0.35em")
                    .attr("font-size", "14px")
                    .attr("font-weight", "600")
                    .attr("fill", "#374151")
                    .style("text-shadow", "0 1px 2px rgba(255, 255, 255, 0.8)")
                    .text(i);
            }

            // Draw nodes with enhanced styling
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
                            .attr("r", 25);
                    })
                    .on("mouseleave", function() {
                        d3.select(this).select("circle")
                            .transition()
                            .duration(200)
                            .attr("r", 22);
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
                    .attr("r", 22)
                    .attr("fill", `url(#${nodeGradientId})`)
                    .attr("stroke", strokeColor)
                    .attr("stroke-width", 3)
                    .style("filter", "drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2))");

                // Add pulsing animation for coordinator
                if (node.isCoordinator) {
                    nodeCircle.style("animation", "nodePulse 2s infinite");
                }

                // Add dashed outline for faulty nodes
                if (node.isCrashed || node.isByzantine) {
                    nodeGroup.append("circle")
                        .attr("r", 27)
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
                    .attr("font-size", "16px")
                    .attr("font-weight", "bold")
                    .attr("fill", textColor)
                    .style("text-shadow", node.isCrashed ? "none" : "0 1px 2px rgba(0, 0, 0, 0.5)")
                    .text(id);

                // Add status indicators
                if (node.isCoordinator) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", "-30px")
                        .attr("font-size", "14px")
                        .attr("fill", "#f59e0b")
                        .text("⭐");
                }

                if (node.isCrashed) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", "-30px")
                        .attr("font-size", "14px")
                        .attr("fill", "#ef4444")
                        .text("💥");
                }

                if (node.isByzantine) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", "-30px")
                        .attr("font-size", "14px")
                        .attr("fill", "#dc2626")
                        .text("🔥");
                }

                // Show object count if any
                if (node.objectBucket.size > 0) {
                    nodeGroup.append("text")
                        .attr("text-anchor", "middle")
                        .attr("dy", "35px")
                        .attr("font-size", "12px")
                        .attr("font-weight", "bold")
                        .attr("fill", "#059669")
                        .style("text-shadow", "0 1px 2px rgba(255, 255, 255, 0.8)")
                        .text(`📦${node.objectBucket.size}`);
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

        function addNode() {
            const nodeId = parseInt(document.getElementById('nodeId').value);
            if (isNaN(nodeId) || nodeId < 0 || nodeId >= chord.ringSize) {
                alert('Please enter a valid node ID between 0 and ' + (chord.ringSize - 1));
                return;
            }

            if (chord.addNode(nodeId)) {
                updateVisualization();
                document.getElementById('nodeId').value = '';
            } else {
                alert('Node with ID ' + nodeId + ' already exists!');
            }
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
            const availableIds = [];
            for (let i = 0; i < chord.ringSize; i++) {
                if (!chord.nodes.has(i)) {
                    availableIds.push(i);
                }
            }

            if (availableIds.length === 0) {
                alert('All node positions are occupied!');
                return;
            }

            const randomId = availableIds[Math.floor(Math.random() * availableIds.length)];
            chord.addNode(randomId);
            updateVisualization();
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

        function animateLookupPath(path) {
            // Clear previous animations
            svg.selectAll(".lookup-path").remove();
            svg.selectAll(".node-highlight").remove();

            if (path.length < 2) return;

            // Highlight nodes in the path
            path.forEach((node, index) => {
                const angle = (node.id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                const x = centerX + radius * Math.cos(angle);
                const y = centerY + radius * Math.sin(angle);

                setTimeout(() => {
                    svg.append("circle")
                        .attr("class", "node-highlight")
                        .attr("cx", x)
                        .attr("cy", y)
                        .attr("r", 25)
                        .attr("fill", "none")
                        .attr("stroke", "#dc2626")
                        .attr("stroke-width", 3)
                        .style("opacity", 0)
                        .transition()
                        .duration(300)
                        .style("opacity", 1)
                        .transition()
                        .delay(800)
                        .duration(300)
                        .style("opacity", 0)
                        .remove();
                }, index * 500);
            });

            // Draw path lines
            for (let i = 0; i < path.length - 1; i++) {
                const node1 = path[i];
                const node2 = path[i + 1];
                
                const angle1 = (node1.id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                const angle2 = (node2.id * 2 * Math.PI) / chord.ringSize - Math.PI / 2;
                const x1 = centerX + radius * Math.cos(angle1);
                const y1 = centerY + radius * Math.sin(angle1);
                const x2 = centerX + radius * Math.cos(angle2);
                const y2 = centerY + radius * Math.sin(angle2);

                setTimeout(() => {
                    svg.append("line")
                        .attr("class", "lookup-path")
                        .attr("x1", x1)
                        .attr("y1", y1)
                        .attr("x2", x2)
                        .attr("y2", y2)
                        .style("opacity", 0)
                        .transition()
                        .duration(300)
                        .style("opacity", 1)
                        .transition()
                        .delay(1000)
                        .duration(500)
                        .style("opacity", 0)
                        .remove();
                }, i * 500);
            }
        }

        // New enhanced functions
        function performObjectLookup() {
            const key = parseInt(document.getElementById('objectLookupKey').value);
            if (isNaN(key)) {
                alert('Please enter a valid object key');
                return;
            }

            if (chord.nodes.size === 0) {
                alert('Add some nodes first!');
                return;
            }

            const result = chord.lookup(key, null, true);
            const resultDiv = document.getElementById('lookupResult');
            
            if (result.path.length > 0) {
                const pathStr = result.path.map(node => node.id).join(' → ');
                const statusColor = result.found ? '#059669' : '#dc2626';
                const statusText = result.found ? 'Found' : 'Not Found';
                
                resultDiv.innerHTML = `
                    <div class="lookup-result">
                        <h4 style="color: #92400e; font-size: 1.1rem; margin-bottom: 10px; font-weight: 600;">
                            🎯 Object ${key} Lookup Result
                        </h4>
                        <div style="color: #451a03;">
                            <strong>Status:</strong> <span style="color: ${statusColor};">${statusText}</span><br>
                            <strong>Hash:</strong> ${ChordNode.hashObject(key, chord.ringSize)}<br>
                            <strong>Path:</strong> ${pathStr}<br>
                            <strong>Responsible Node:</strong> ${result.responsible.id}<br>
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

        function injectCrashFault() {
            const nodeId = parseInt(document.getElementById('faultNodeId').value);
            if (isNaN(nodeId) || !chord.nodes.has(nodeId)) {
                alert('Please enter a valid node ID that exists in the ring');
                return;
            }
            
            chord.injectFault(nodeId, 'crash');
            updateVisualization();
            updateStats();
        }

        function injectByzantineFault() {
            const nodeId = parseInt(document.getElementById('faultNodeId').value);
            if (isNaN(nodeId) || !chord.nodes.has(nodeId)) {
                alert('Please enter a valid node ID that exists in the ring');
                return;
            }
            
            chord.injectFault(nodeId, 'byzantine');
            updateVisualization();
            updateStats();
        }

        function clearFaults() {
            chord.nodes.forEach(node => {
                node.isCrashed = false;
                node.isByzantine = false;
                node.status = 'active';
            });
            
            log('All faults cleared', 'success');
            updateVisualization();
            updateStats();
        }

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

        // Initialize the visualization when the page loads
        window.addEventListener('load', () => {
            initVisualization();
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

        // Handle window resize
        window.addEventListener('resize', () => {
            setTimeout(initVisualization, 100);
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

        // Mobile orientation handling
        function checkOrientation() {
            const overlay = document.querySelector('.rotate-device-overlay');
            const isMobile = window.innerWidth < 768;
            const isPortrait = window.innerHeight > window.innerWidth;
            
            if (isMobile && isPortrait) {
                overlay.style.display = 'flex';
            } else {
                overlay.style.display = 'none';
            }
        }

        // Check orientation on load and resize
        window.addEventListener('load', checkOrientation);
        window.addEventListener('resize', checkOrientation);
        window.addEventListener('orientationchange', () => {
            setTimeout(checkOrientation, 100);
        });