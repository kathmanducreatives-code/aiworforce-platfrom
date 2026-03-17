import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';

import '../providers/app_provider.dart';
import '../widgets/crop_card.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppProvider>();
    final lastScan = app.detections.isNotEmpty
        ? DateTime.fromMillisecondsSinceEpoch(app.detections.first.timestamp)
        : null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('AgriDrone Guardian'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.of(context).pushNamed('/settings'),
          ),
        ],
      ),
      body: app.isLoading
          ? const _LoadingSkeleton()
          : RefreshIndicator(
              onRefresh: () => app.refreshNow(),
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _Header(app: app, lastScan: lastScan),
                  const SizedBox(height: 16),
                  Text(
                    'Select Crop',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  GridView.count(
                    crossAxisCount:
                        MediaQuery.of(context).size.width < 600 ? 2 : 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    childAspectRatio: 1.2,
                    crossAxisSpacing: 12,
                    mainAxisSpacing: 12,
                    children: [
                      CropCard(
                        label: 'Rice',
                        icon: Icons.grass,
                        selected: app.selectedCrop == 'rice',
                        onTap: () => app.setCrop('rice'),
                      ),
                      CropCard(
                        label: 'Wheat',
                        icon: Icons.agriculture,
                        selected: app.selectedCrop == 'wheat',
                        onTap: () => app.setCrop('wheat'),
                      ),
                      CropCard(
                        label: 'Maize',
                        icon: Icons.spa,
                        selected: app.selectedCrop == 'maize',
                        onTap: () => app.setCrop('maize'),
                      ),
                      CropCard(
                        label: 'Potato',
                        icon: Icons.local_florist,
                        selected: app.selectedCrop == 'potato',
                        onTap: () => app.setCrop('potato'),
                      ),
                      CropCard(
                        label: 'Tomato',
                        icon: Icons.eco,
                        selected: app.selectedCrop == 'tomato',
                        onTap: () => app.setCrop('tomato'),
                      ),
                      CropCard(
                        label: 'Pepper',
                        icon: Icons.park,
                        selected: app.selectedCrop == 'pepper',
                        onTap: () => app.setCrop('pepper'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }
}

class _Header extends StatelessWidget {
  final AppProvider app;
  final DateTime? lastScan;

  const _Header({required this.app, required this.lastScan});

  @override
  Widget build(BuildContext context) {
    final status = app.droneStatus;
    final connected = status?.connected == true;
    final flying = status?.flying == true;

    String statusText = 'Disconnected';
    Color statusColor = Colors.red;
    if (connected && flying) {
      statusText = 'Flying';
      statusColor = Colors.orange;
    } else if (connected) {
      statusText = 'Connected';
      statusColor = Colors.green;
    }

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Icon(Icons.air, size: 28),
              const SizedBox(width: 8),
              Text(
                'Drone Status',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ]),
            const SizedBox(height: 8),
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: statusColor,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text(statusText),
                const Spacer(),
                if (status != null) Text('Battery ${status.battery}%'),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              lastScan == null
                  ? 'Last scan: unavailable'
                  : 'Last scan: ${DateFormat.yMMMd().add_jm().format(lastScan!)}',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
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
      children: List.generate(
        6,
        (i) => Container(
          height: 90,
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
