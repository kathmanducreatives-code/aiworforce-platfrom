import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../providers/app_provider.dart';
import '../widgets/disease_card.dart';

class ResultScreen extends StatelessWidget {
  const ResultScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppProvider>();
    final latest = app.detections.isNotEmpty ? app.detections.first : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Disease Results')),
      body: app.isLoading
          ? const _LoadingSkeleton()
          : RefreshIndicator(
              onRefresh: () => app.refreshNow(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (app.errorMessage != null)
                    _MessageBanner(text: app.errorMessage!),
                  if (latest != null) DiseaseCard(detection: latest),
                  const SizedBox(height: 16),
                  Text(
                    'History (Last 10)',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  ...app.detections.map((d) {
                    final time = DateFormat.jm().format(
                      DateTime.fromMillisecondsSinceEpoch(d.timestamp),
                    );
                    return ListTile(
                      leading: const Icon(Icons.local_florist),
                      title: Text('${_titleCase(d.crop)} - ${d.disease}'),
                      subtitle: Text('Confidence ${(d.confidence * 100).toInt()}%'),
                      trailing: Text(time),
                    );
                  }).toList(),
                ],
              ),
            ),
    );
  }
}

class _MessageBanner extends StatelessWidget {
  final String text;
  const _MessageBanner({required this.text});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.amber.shade100,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            const Icon(Icons.info_outline),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
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

class _LoadingSkeleton extends StatelessWidget {
  const _LoadingSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: List.generate(
        6,
        (i) => Container(
          height: 100,
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
    );
  }
}
