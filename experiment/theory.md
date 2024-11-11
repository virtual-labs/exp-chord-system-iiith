# Chord - Distributed Hash Table. 

## Introduction 

A distributed hash table (DHT) is a distributed system that provides a lookup service similar to a hash table. Key–value pairs are stored in a DHT, and any participating node can efficiently retrieve the value associated with a given key. Such a system is designed to achieve following objectives. These objectives are inspired by practical applications, and there are many services which rely on DHT to work. 

1. Decentralisation : Avoiding a centralised coordination to make system work.
2. Fault tolerance & Robustness : System is robust to data/node dynamics (nodes leaving/adding), data changes, node failure. 
3. Scalability : Performance must not depreciate with scale. 


Problem at hand is the following: There is a collection of machines/servers on which we want to run some query. More specifically, we want to save files/data on network, and then retrieve them. We may decide to delete/modify some data, or some nodes may leave or a new node may even join. These requirements are fairly reasonable for any practical service.  It is obviously infeasible to store all data on every machine (why?). If we decide to distribute data over these machines, but devise no efficient mechanism to search, it is equally bad (why?). Chord is designed to hit all three requirements as enumerated above. 

A concept central to DHTs is that of an **overlay network**. This network is often called (abused) as “logical network”. This "network" is simply a description of a specific way for nodes to communicate. The scheme is such that it achieves a specific purpose (and we are able to prove performance guarantees mathematically). 

## Overview

Recall that a hash-table maps key to values. DHT stores key-value pairs and a participating node can efficiently retrieve the value associated with a given key. In Chord, nodes and keys are assigned say, m bit, identifiers using consistent hashing (SHA-1) for performance guarantees. We therefore have a mechanism to generate ids for both keys and nodes.  Both key and node share same key-space -consistent hashing minimises collisions by distributing both keys and node ids uniformly. 


It will be helpful to refer to geometric interpretation of *chord* while understanding Chord protocol. We place node ids clockwise in an (imaginary) circle with 2<sup>m</sup> entries (m being large enough) in increasing order. We can now define *successor* and *predecessor* functions for nodes : *successor*(n) of node n is the next node in circle clockwise; *predecessor*(n) is defined analogously. We further extend this idea to keys as well : we say that "successor" node of key *k* is the first node whose id follows *k* in circle. The operation is therefore well defined :  we will store key *k* at node *successor*(*k*).

The following is the core of Chord protocol (and justifies the name “chord”). Each node stores a small table called “finger table”. This table contains m entries of the form : i<sup>th</sup> entry of table is :  successor((n+2<sup>i-1</sup>)mod 2<sup>m</sup>)


We again, and for the last time, abuse language and say, “node n is *logically connected* to all nodes in its finger table”. We call such connections as “chords”. Observe that, for a node, chords differ successively by a factor of 2. 

*Inline Exercise 1* : Prove that all the fingers cumulatively cover the entire circle. 

## Algorithm

The idea for search algorithm can be visualised geometrically : if a node receives a query, we search for, in the induced geometric circle, the *arc* which contains the key. The strategy is to reduce this search space by a constant factor (repeatedly) until we find the node containing the key. Without getting into details of implementation, we provide high level idea of the approach. Interested reader is directed to [K&S]. Note that all computations are done under *mod* 2<sup>m</sup>. 

**Recursive_Preceding _Node()**: *Node routes query to node p corresponding to value (in its finger table) immediately less than hash(q)*.  

By calling above function, we recursively find the best estimate of the *preceding* node (in circle), until we can no longer do so. 

## Analysis 

*Inline Exercise 2*: Argue that above routine reduces the search space by at least half.

**Complexity of Search** : It directly follows from Exercise 2 that in O(log n) steps, required node is found. 

**Corner case** : In practice, exact match between hash of key and hash of node is very rare. 

*Inline Exercise 3* : Modify **Recursive_Preceding _Node()** to handle the corner case. 


We remark that *Initialisation* routine is a basic routine which sets a node’s fields (finger table, predecessor) correctly. By also storing *predecessor* of every node in the node itself we can handle node addition/deletion by adding/deleting specific entries in other nodes' fields, and by running *Initialisation* routine for new node. Interested reader can attempt to define these sub-routines, which are fairly straightforward. Details are in [K&S].
