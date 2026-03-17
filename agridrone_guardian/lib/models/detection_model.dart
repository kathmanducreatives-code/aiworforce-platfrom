class DetectionModel {
  final String crop;
  final String disease;
  final double confidence;
  final String severity;
  final String imageUrl;
  final int timestamp;

  DetectionModel({
    required this.crop,
    required this.disease,
    required this.confidence,
    required this.severity,
    required this.imageUrl,
    required this.timestamp,
  });

  factory DetectionModel.fromMap(Map<String, dynamic> data) {
    return DetectionModel(
      crop: (data['crop'] ?? '').toString(),
      disease: (data['disease'] ?? '').toString().replaceAll('_', ' '),
      confidence: (data['confidence'] ?? 0).toDouble(),
      severity: (data['severity'] ?? 'healthy').toString(),
      imageUrl: (data['imageUrl'] ?? '').toString(),
      timestamp: (data['timestamp'] ?? 0) is int
          ? data['timestamp']
          : int.tryParse(data['timestamp'].toString()) ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'crop': crop,
      'disease': disease,
      'confidence': confidence,
      'severity': severity,
      'imageUrl': imageUrl,
      'timestamp': timestamp,
    };
  }
}
