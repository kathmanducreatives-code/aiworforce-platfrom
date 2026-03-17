import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/detection_model.dart';

class DiseaseCard extends StatelessWidget {
  final DetectionModel detection;
  const DiseaseCard({super.key, required this.detection});

  @override
  Widget build(BuildContext context) {
    final severity = detection.severity.toLowerCase();
    Color badgeColor = Colors.green;
    String label = 'Healthy';
    if (severity.contains('mild')) {
      badgeColor = Colors.orange;
      label = 'Mild';
    } else if (severity.contains('severe')) {
      badgeColor = Colors.red;
      label = 'Severe';
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${_titleCase(detection.crop)} - ${detection.disease}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                SizedBox(
                  width: 64,
                  height: 64,
                  child: CircularProgressIndicator(
                    value: detection.confidence,
                    strokeWidth: 8,
                    color: const Color(0xFF2E7D32),
                    backgroundColor: Colors.grey.shade200,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  '${(detection.confidence * 100).toInt()}% confidence',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: badgeColor.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    label,
                    style: TextStyle(color: badgeColor),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Detected: ${DateFormat.yMMMd().add_jm().format(DateTime.fromMillisecondsSinceEpoch(detection.timestamp))}',
            ),
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.network(
                detection.imageUrl,
                height: 180,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  height: 180,
                  color: Colors.grey.shade200,
                  alignment: Alignment.center,
                  child: const Text('Image unavailable'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _titleCase(String s) {
  if (s.isEmpty) return s;
  return s[0].toUpperCase() + s.substring(1);
}
