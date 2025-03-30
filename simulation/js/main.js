// Chord Node class
class Node {
  constructor(id, m) {
      this.id = id;
      this.m = m; // Number of bits for identifier space (2^m)
      this.fingerTable = [];
      this.successor = null;
      this.predecessor = null;
      this.keys = [];
  }

  updateFingerTable(ring) {
      this.fingerTable = [];
      for (let k = 1; k <= this.m; k++) {
          const start = (this.id + Math.pow(2, k - 1)) % Math.pow(2, this.m);
          this.fingerTable[k - 1] = ring.findSuccessor(start);
      }
  }

  storeKey(key) {
      this.keys.push(key);
      this.keys.sort((a, b) => a - b);
  }
}

// Chord Ring class
class ChordRing {
  constructor(m) {
      this.m = m;
      this.nodes = [];
  }

  addNode(id) {
      if (this.nodes.some(node => node.id === id)) {
          return false; // Prevent duplicate IDs
      }
      const newNode = new Node(id, this.m);
      this.nodes.push(newNode);
      this.nodes.sort((a, b) => a.id - b.id);
      this.updateRing();

      // Transfer keys from successor to new node
      if (newNode.successor) {
        const keysToTransfer = newNode.successor.keys.filter(key =>
            this.isBetween(key, newNode.predecessor.id, newNode.id)
        );
        newNode.keys.push(...keysToTransfer);
        newNode.successor.keys = newNode.successor.keys.filter(key =>
            !keysToTransfer.includes(key)
        );
      }
    return true;
  }

  isBetween(key, start, end) {
    const mod = Math.pow(2, this.m); // Ring size, e.g., 2^6 = 64
    key = (key % mod + mod) % mod;   // Normalize to [0, 2^m - 1]
    start = (start % mod + mod) % mod;
    end = (end % mod + mod) % mod;
    if (start < end) {
        return key > start && key <= end; // Non-wrapping range
    } else {
        return key > start || key <= end; // Wrapping range
    }
  }

  removeNode(id) {
      const index = this.nodes.findIndex(node => node.id === id);
      if (index === -1) return false;
      const removedNode = this.nodes.splice(index, 1)[0];
      if (removedNode.successor) {
          removedNode.successor.keys.push(...removedNode.keys);
          removedNode.successor.keys.sort((a, b) => a - b);
      }
      this.updateRing();
      return true;
  }

  updateRing() {
      const n = this.nodes.length;
      if (n === 0) return;
      for (let i = 0; i < n; i++) {
          const current = this.nodes[i];
          current.successor = this.nodes[(i + 1) % n];
          current.predecessor = this.nodes[(i - 1 + n) % n];
          current.updateFingerTable(this);
      }
  }

  findSuccessor(id) {
      if (this.nodes.length === 0) return null;
      for (let i = 0; i < this.nodes.length; i++) {
          if (this.nodes[i].id >= id) {
              return this.nodes[i];
          }
      }
      return this.nodes[0]; // Wrap around
  }

  insertKey(key) {
      const successor = this.findSuccessor(key);
      if (successor) successor.storeKey(key);
  }

  lookupKey(startNode, key) {
    let current = startNode;
    const path = [current]; // Track the path for feedback

    // Continue until we reach the key's successor
    while (current !== this.findSuccessor(key)) {
        let next = null;
        // Search finger table from farthest to closest
        for (let k = this.m - 1; k >= 0; k--) {
            const fingerNode = current.fingerTable[k];
            if (fingerNode && this.isPredecessor(fingerNode.id, key, current.id)) {
                next = fingerNode;
                break; // Found the closest predecessor, move to it
            }
        }
        // If no better finger found, use successor
        if (!next) {
            next = current.successor;
        }
        current = next;
        path.push(current);
    }
    return { node: current, path };
  }

  // Helper: Check if fingerId is a predecessor to key relative to currentId
  isPredecessor(fingerId, key, currentId) {
    if (currentId < key) {
        return fingerId > currentId && fingerId < key;
    } else if (currentId > key) {
        // Handle wrap-around in the ring
        return fingerId > currentId || fingerId < key;
    }
    return false; // currentId equals key, no move needed
  }

  removeKey(key) {
    const successor = this.findSuccessor(key);
    if (successor) {
        const index = successor.keys.indexOf(key);
        if (index !== -1) {
            successor.keys.splice(index, 1);
            return true;
        }
    }
    return false;
  }

  isBetween(id, start, end) {
      if (start < end) {
          return id > start && id <= end;
      } else {
          return id > start || id <= end;
      }
  }
}

// Canvas setup
const canvas = document.getElementById('chord-ring');
const ctx = canvas.getContext('2d');
const centerX = canvas.width / 2;
const centerY = canvas.height / 2;
const radius = 250;
let selectedNode = null;

// Initialize Chord ring with m=6 (0-63 identifier space)
const ring = new ChordRing(6);

function drawRing() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#000';
  ctx.stroke();

  for (let node of ring.nodes) {
    const angle = (node.id / Math.pow(2, ring.m)) * 2 * Math.PI;
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, 2 * Math.PI);
    ctx.fillStyle = selectedNode && selectedNode.id === node.id ? 'yellow' : 'lightblue';
    ctx.fill();
    ctx.stroke();
    // Use a large font size for better visibility.
    ctx.font = '12px Arial';
    ctx.fillStyle = 'black';
    ctx.fillText(node.id.toString().padStart(2, '0'), x - 8, y + 4);
    ctx.fillText(`Keys: ${node.keys.length}`, x - 15, y + 20); // Added line
  }
}

// Event listeners for controls
document.getElementById('add-node').addEventListener('click', () => {
  const id = parseInt(document.getElementById('node-id-input').value);
  if (!isNaN(id) && id >= 0 && id < Math.pow(2, ring.m)) {
      if (ring.addNode(id)) {
          drawRing();
          document.getElementById('feedback').textContent = `Node ${id} added.`;
      } else {
          document.getElementById('feedback').textContent = `Node ${id} already exists.`;
      }
  } else {
      const randomId = Math.floor(Math.random() * Math.pow(2, ring.m));
      ring.addNode(randomId);
      drawRing();
      document.getElementById('feedback').textContent = `Node ${randomId} added (random).`;
  }
});

document.getElementById('remove-node').addEventListener('click', () => {
  const id = parseInt(document.getElementById('node-id-input').value);
  if (!isNaN(id) && ring.removeNode(id)) {
      drawRing();
      document.getElementById('feedback').textContent = `Node ${id} removed.`;
      if (selectedNode && selectedNode.id === id) {
          selectedNode = null;
          document.getElementById('node-details').innerHTML = '<h3>Node Details</h3><p>Select a node to view its details.</p>';
      }
  } else {
      document.getElementById('feedback').textContent = 'Invalid or non-existent node ID.';
  }
});

document.getElementById('insert-key').addEventListener('click', () => {
  const key = parseInt(document.getElementById('key-input').value);
  if (!isNaN(key) && key >= 0 && key < Math.pow(2, ring.m)) {
      ring.insertKey(key);
      drawRing();
      document.getElementById('feedback').textContent = `Key ${key} inserted.`;
  } else {
      document.getElementById('feedback').textContent = 'Invalid key.';
  }
});

document.getElementById('lookup-key').addEventListener('click', () => {
  const key = parseInt(document.getElementById('key-input').value);
  if (!isNaN(key) && ring.nodes.length > 0) {
      const startNode = ring.nodes[0];
      const result = ring.lookupKey(startNode, key);
      document.getElementById('feedback').textContent = `Key ${key} found at node ${result.node.id}. Path: ${result.path.map(n => n.id).join(' -> ')}`;
      // Optionally animate the path on the canvas
  } else {
      document.getElementById('feedback').textContent = 'Invalid key or empty ring.';
  }
});

document.getElementById('remove-key').addEventListener('click', () => {
  const key = parseInt(document.getElementById('key-input').value);
  if (!isNaN(key) && key >= 0 && key < Math.pow(2, ring.m)) {
      if (ring.removeKey(key)) {
          drawRing();
          document.getElementById('feedback').textContent = `Key ${key} removed.`;
      } else {
          document.getElementById('feedback').textContent = `Key ${key} not found.`;
      }
  } else {
      document.getElementById('feedback').textContent = 'Invalid key.';
  }
});

// Node selection
canvas.addEventListener('click', (event) => {
  const rect = canvas.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  selectedNode = null;
  ring.nodes.forEach(node => {
      const angle = (node.id / Math.pow(2, ring.m)) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      const distance = Math.sqrt((clickX - x) ** 2 + (clickY - y) ** 2);
      if (distance < 15) { // Click within 15px of node
          selectedNode = node;
      }
  });
  if (selectedNode) {
      document.getElementById('node-details').innerHTML = `
          <h3>Node ${selectedNode.id}</h3>
          <p>Successor: ${selectedNode.successor.id}</p>
          <p>Predecessor: ${selectedNode.predecessor.id}</p>
          <p>Finger Table: ${selectedNode.fingerTable.map(n => n.id).join(', ')}</p>
          <p>Keys: ${selectedNode.keys.join(', ') || 'None'}</p>
      `;
      drawRing();
  }
});

// Define challenge types at the top level
const challengeTypes = ['keyStorage', 'fingerTable', 'lookupHops', 'successor', 'predecessor'];

// Function to start a new challenge
function startChallenge() {
    // Check if there are enough nodes in the ring
    if (ring.nodes.length < 2) {
        document.getElementById('feedback').textContent = 'Add at least two nodes to start challenges.';
        return;
    }

    // Randomly select a challenge type
    const type = challengeTypes[Math.floor(Math.random() * challengeTypes.length)];
    let question, correctAnswer, explanation;

    // Generate question and answer based on challenge type
    if (type === 'keyStorage') {
        // Challenge: Which node will store key X?
        const key = Math.floor(Math.random() * Math.pow(2, ring.m));
        const successor = ring.findSuccessor(key);
        question = `Which node will store key ${key}?`;
        correctAnswer = successor.id;
        explanation = `Key ${key} is stored at node ${successor.id} because it is the successor of ${key}.`;
    } else if (type === 'fingerTable') {
        // Challenge: What is finger[k] for node N?
        const node = ring.nodes[Math.floor(Math.random() * ring.nodes.length)];
        const k = Math.floor(Math.random() * ring.m) + 1;
        const fingerNode = node.fingerTable[k - 1];
        question = `What is finger[${k}] for node ${node.id}?`;
        correctAnswer = fingerNode.id;
        explanation = `Finger[${k}] for node ${node.id} is node ${fingerNode.id}, which is the successor of ${(node.id + Math.pow(2, k - 1)) % Math.pow(2, ring.m)}.`;
    } else if (type === 'lookupHops') {
        // Challenge: How many hops to find key K from node M?
        const startNode = ring.nodes[Math.floor(Math.random() * ring.nodes.length)];
        const key = Math.floor(Math.random() * Math.pow(2, ring.m));
        const result = ring.lookupKey(startNode, key);
        const hops = result.path.length - 1; // Path includes start node, so hops = length - 1
        question = `How many hops does it take to find key ${key} from node ${startNode.id}?`;
        correctAnswer = hops;
        explanation = `It takes ${hops} hops to find key ${key} from node ${startNode.id}. The path is ${result.path.map(n => n.id).join(' -> ')}.`;
    } else if (type === 'successor') {
        // Challenge: Who is the successor of node N?
        const node = ring.nodes[Math.floor(Math.random() * ring.nodes.length)];
        question = `Who is the successor of node ${node.id}?`;
        correctAnswer = node.successor.id;
        explanation = `The successor of node ${node.id} is node ${node.successor.id}.`;
    } else if (type === 'predecessor') {
        // Challenge: Who is the predecessor of node N?
        const node = ring.nodes[Math.floor(Math.random() * ring.nodes.length)];
        question = `Who is the predecessor of node ${node.id}?`;
        correctAnswer = node.predecessor.id;
        explanation = `The predecessor of node ${node.id} is node ${node.predecessor.id}.`;
    }

    // Prompt user for answer
    const userAnswer = prompt(question);
    if (userAnswer === null) return; // User cancelled the prompt

    // Convert user answer to number for comparison (since node IDs and hops are numeric)
    const userAnswerNum = parseInt(userAnswer);

    // Provide feedback
    if (!isNaN(userAnswerNum) && userAnswerNum === correctAnswer) {
        document.getElementById('feedback').textContent = `Correct! ${explanation}`;
    } else {
        document.getElementById('feedback').textContent = `Incorrect. The correct answer is ${correctAnswer}. ${explanation}`;
    }
}

// Attach the function to the "Start Challenge" button
document.getElementById('challenge').addEventListener('click', startChallenge);

// Initial draw
drawRing();
