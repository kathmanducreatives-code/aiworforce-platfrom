class SoilModel {
  final double moisture;
  final int timestamp;

  SoilModel({
    required this.moisture,
    required this.timestamp,
  });

  factory SoilModel.fromMap(Map<String, dynamic> data) {
    return SoilModel(
      moisture: (data['moisture'] ?? 0).toDouble(),
      timestamp: (data['timestamp'] ?? 0) is int
          ? data['timestamp']
          : int.tryParse(data['timestamp'].toString()) ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'moisture': moisture,
      'timestamp': timestamp,
    };
  }
}
