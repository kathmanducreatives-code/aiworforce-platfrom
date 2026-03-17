import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import 'package:fl_chart/fl_chart.dart';

import '../providers/app_provider.dart';
import '../models/soil_model.dart';

class SoilScreen extends StatelessWidget {
  const SoilScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppProvider>();
    final latest = app.soil.isNotEmpty ? app.soil.last : null;

    return Scaffold(
      appBar: AppBar(title: const Text('Soil Moisture')),
      body: app.isLoading
          ? const _LoadingSkeleton()
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (latest != null) _Gauge(latest: latest),
                const SizedBox(height: 16),
                Text(
                  'Last 24 Hours',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                _SoilChart(data: app.soil),
              ],
            ),
    );
  }
}

class _Gauge extends StatelessWidget {
  final SoilModel latest;
  const _Gauge({required this.latest});

  @override
  Widget build(BuildContext context) {
    final moisture = latest.moisture;
    final color = moisture < 30
        ? Colors.red
        : moisture < 60
            ? Colors.orange
            : Colors.green;
    final text = moisture < 30
        ? 'Irrigation needed immediately'
        : moisture < 60
            ? 'Monitor soil — irrigation may be needed soon'
            : 'Soil moisture is optimal';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            SizedBox(
              width: 160,
              height: 160,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  CircularProgressIndicator(
                    value: moisture / 100,
                    strokeWidth: 12,
                    color: color,
                    backgroundColor: Colors.grey.shade200,
                  ),
                  Text('${moisture.toStringAsFixed(1)}%'),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              text,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 8),
            Text(
              'Last updated: ${DateFormat.yMMMd().add_jm().format(DateTime.fromMillisecondsSinceEpoch(latest.timestamp))}',
            ),
          ],
        ),
      ),
    );
  }
}

class _SoilChart extends StatelessWidget {
  final List<SoilModel> data;
  const _SoilChart({required this.data});

  @override
  Widget build(BuildContext context) {
    if (data.isEmpty) {
      return const SizedBox(height: 200, child: Center(child: Text('No data')));
    }
    final spots = <FlSpot>[];
    for (var i = 0; i < data.length; i++) {
      spots.add(FlSpot(i.toDouble(), data[i].moisture));
    }

    return Card(
      child: SizedBox(
        height: 240,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: LineChart(
            LineChartData(
              minY: 0,
              maxY: 100,
              gridData: const FlGridData(show: false),
              borderData: FlBorderData(show: false),
              titlesData: const FlTitlesData(show: false),
              lineBarsData: [
                LineChartBarData(
                  spots: spots,
                  isCurved: true,
                  color: const Color(0xFF2E7D32),
                  barWidth: 3,
                  dotData: const FlDotData(show: false),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LoadingSkeleton extends StatelessWidget {
  const _LoadingSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          height: 220,
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        const SizedBox(height: 16),
        Container(
          height: 240,
          decoration: BoxDecoration(
            color: Colors.grey.shade300,
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ],
    );
  }
}
