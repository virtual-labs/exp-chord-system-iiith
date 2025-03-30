### Procedure

### 1. Setup and Familiarization
**Objective:** Understand the lab interface and basic Chord ring structure.
1. Open the virtual lab in a web browser.
2. Observe the circular Chord ring (mod 64 identifier space) and control panel.
3. Review the input fields and buttons:
   - **Node ID (0-63):** For adding/removing nodes.
   - **Key (0-63):** For inserting, looking up, or removing keys.
   - **Node Details Panel:** Displays finger tables, keys, and neighbors when a node is clicked.

---

### 2. Basic Node Operations
**Objective:** Learn how nodes join/leave the ring and how the topology updates.
1. **Add Nodes:**
   - Click *Add Node* to place nodes (e.g., IDs 8, 20, 35, 50).
   - Observe their positions on the ring.
   - **Question:** *Why do nodes occupy specific positions?*
2. **Remove Nodes:**
   - Remove a node (e.g., 20) and watch its keys transfer to its successor.
   - **Question:** *How does the ring handle node departures?*

---

### 3. Key Management
**Objective:** Explore how keys are stored using consistent hashing.
1. **Insert Keys:**
   - Insert keys (e.g., 15, 25, 40) and note which nodes store them.
   - **Question:** *Which node becomes responsible for key 25? Why?*
2. **Remove Keys:**
   - Remove a key and verify its deletion from the successor node.

---

### 4. Finger Table Analysis
**Objective:** Understand how finger tables enable efficient lookups.
1. Click a node to view its finger table, successor, and predecessor.
2. **Observe Finger Entries:**
   - Entries are successors of $\text{node.id} + 2^{k-1} \mod 64$.
   - **Question:** *How do finger entries reduce lookup hops?*

---

### 5. Key Lookup Simulation
**Objective:** Trace the path of a key lookup using finger tables.
1. **Perform a Lookup:**
   - Enter a key (e.g., 45) and click *Lookup Key*.
   - Study the feedback showing the path (e.g., *Node 8 → Node 35 → Node 50*).
2. **Analyze Hops:**
   - Compare the number of hops to $O(\log N)$ efficiency.

---

### 6. Dynamic Ring Changes
**Objective:** Observe how the ring adapts to node joins/leaves.
1. **Add a New Node:**
   - Insert a node (e.g., 30) and watch keys transfer from its successor.
   - Verify its finger table updates.
2. **Remove a Critical Node:**
   - Delete a heavily loaded node and observe key redistribution.

---

### 7. Interactive Challenges
**Objective:** Test understanding of Chord mechanics.
1. Click *Start Challenge* to answer auto-generated questions:
   - **Example 1:** *"Which node stores key 18?"*
   - **Example 2:** *"What is finger[3] for node 20?"*
2. Use feedback to correct mistakes and refine understanding.

---

### 8. Advanced Exploration
**Objective:** Investigate fault tolerance and load balancing.
1. **Simulate Node Failures:**
   - Remove multiple nodes and check if lookups still succeed.
2. **Analyze Load Distribution:**
   - Insert 20 keys and observe distribution across nodes.
   - **Question:** *How can you balance the load?*
