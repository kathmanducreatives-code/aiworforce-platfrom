import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/detection_model.dart';
import '../models/soil_model.dart';

class DroneStatus {
  final bool connected;
  final bool flying;
  final int battery;
  final int lastSeen;

  DroneStatus({
    required this.connected,
    required this.flying,
    required this.battery,
    required this.lastSeen,
  });

  factory DroneStatus.fromMap(Map data) {
    return DroneStatus(
      connected: data['connected'] == true,
      flying: data['flying'] == true,
      battery: (data['battery'] ?? 0) is int ? data['battery'] : 0,
      lastSeen: (data['lastSeen'] ?? 0) is int ? data['lastSeen'] : 0,
    );
  }
}

class FirebaseService {
  FirebaseDatabase? _db;
  bool firebaseReady = false;

  Future<void> init() async {
    try {
      await Firebase.initializeApp();
      _db = FirebaseDatabase.instance;
      firebaseReady = true;
      _db!.setPersistenceEnabled(true);

      try {
        await FirebaseAuth.instance.signInAnonymously();
      } catch (_) {}

      try {
        await FirebaseMessaging.instance.requestPermission();
      } catch (_) {}
    } catch (_) {
      firebaseReady = false;
    }
  }

  Stream<bool> connectionStream() {
    if (_db == null) {
      return Stream.value(false);
    }
    return _db!.ref('.info/connected').onValue.map((event) {
      final val = event.snapshot.value;
      return val == true;
    });
  }

  Stream<List<DetectionModel>> detectionsStream() {
    if (_db == null) {
      return Stream.value([]);
    }
    final ref = _db!.ref('detections').orderByChild('timestamp').limitToLast(10);
    return ref.onValue.map((event) {
      final data = event.snapshot.value;
      if (data is Map) {
        final items = data.values
            .map((e) => DetectionModel.fromMap(
                Map<String, dynamic>.from(e as Map)))
            .toList();
        items.sort((a, b) => b.timestamp.compareTo(a.timestamp));
        return items;
      }
      return <DetectionModel>[];
    });
  }

  Stream<List<SoilModel>> soilStream() {
    if (_db == null) {
      return Stream.value([]);
    }
    final ref = _db!.ref('soil').orderByChild('timestamp').limitToLast(24);
    return ref.onValue.map((event) {
      final data = event.snapshot.value;
      if (data is Map) {
        final items = data.values
            .map((e) => SoilModel.fromMap(Map<String, dynamic>.from(e as Map)))
            .toList();
        items.sort((a, b) => a.timestamp.compareTo(b.timestamp));
        return items;
      }
      return <SoilModel>[];
    });
  }

  Stream<DroneStatus?> droneStatusStream() {
    if (_db == null) {
      return Stream.value(null);
    }
    return _db!.ref('drone/status').onValue.map((event) {
      final data = event.snapshot.value;
      if (data is Map) {
        return DroneStatus.fromMap(Map<String, dynamic>.from(data));
      }
      return null;
    });
  }

  Future<List<DetectionModel>> fetchDetectionsOnce() async {
    if (_db == null) return [];
    final snap = await _db!
        .ref('detections')
        .orderByChild('timestamp')
        .limitToLast(10)
        .get();
    final data = snap.value;
    if (data is Map) {
      final items = data.values
          .map((e) => DetectionModel.fromMap(
              Map<String, dynamic>.from(e as Map)))
          .toList();
      items.sort((a, b) => b.timestamp.compareTo(a.timestamp));
      return items;
    }
    return [];
  }

  Future<List<SoilModel>> fetchSoilOnce() async {
    if (_db == null) return [];
    final snap =
        await _db!.ref('soil').orderByChild('timestamp').limitToLast(24).get();
    final data = snap.value;
    if (data is Map) {
      final items = data.values
          .map((e) => SoilModel.fromMap(Map<String, dynamic>.from(e as Map)))
          .toList();
      items.sort((a, b) => a.timestamp.compareTo(b.timestamp));
      return items;
    }
    return [];
  }

  Future<void> cacheDetections(List<DetectionModel> detections) async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = detections.map((e) => e.toJson()).toList();
    await prefs.setString('cache_detections', jsonEncode(jsonList));
  }

  Future<List<DetectionModel>> loadCachedDetections() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('cache_detections');
    if (raw == null) return [];
    final list = (jsonDecode(raw) as List)
        .map((e) => DetectionModel.fromMap(Map<String, dynamic>.from(e)))
        .toList();
    return list;
  }

  Future<void> cacheSoil(List<SoilModel> soil) async {
    final prefs = await SharedPreferences.getInstance();
    final jsonList = soil.map((e) => e.toJson()).toList();
    await prefs.setString('cache_soil', jsonEncode(jsonList));
  }

  Future<List<SoilModel>> loadCachedSoil() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('cache_soil');
    if (raw == null) return [];
    final list = (jsonDecode(raw) as List)
        .map((e) => SoilModel.fromMap(Map<String, dynamic>.from(e)))
        .toList();
    return list;
  }
}
