import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/app_provider.dart';

class SettingsScreen extends StatefulWidget {
  static const route = '/settings';
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final farmController = TextEditingController(text: 'Green Valley Farm');
  final locationController = TextEditingController(text: 'Nepal');

  bool alertsEnabled = true;

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppProvider>();

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _SectionTitle(text: 'Farm Details'),
          TextField(
            controller: farmController,
            decoration: const InputDecoration(labelText: 'Farm name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: locationController,
            decoration: const InputDecoration(labelText: 'Location'),
          ),
          const SizedBox(height: 20),
          _SectionTitle(text: 'Notifications'),
          SwitchListTile(
            value: alertsEnabled,
            onChanged: (v) => setState(() => alertsEnabled = v),
            title: const Text('Disease alerts'),
          ),
          const SizedBox(height: 20),
          _SectionTitle(text: 'Drone Connection'),
          ListTile(
            leading: const Icon(Icons.wifi),
            title: const Text('Connection status'),
            subtitle: Text(app.firebaseConnected ? 'Connected' : 'Disconnected'),
          ),
          const SizedBox(height: 20),
          _SectionTitle(text: 'About'),
          const ListTile(
            leading: Icon(Icons.info_outline),
            title: Text('App version'),
            subtitle: Text('1.0.0'),
          ),
          const ListTile(
            leading: Icon(Icons.school_outlined),
            title: Text('Project name'),
            subtitle: Text('AgriDrone Guardian'),
          ),
          const ListTile(
            leading: Icon(Icons.account_balance_outlined),
            title: Text('College name'),
            subtitle: Text('Your College Name'),
          ),
          const SizedBox(height: 12),
          ListTile(
            leading: const Icon(Icons.cloud_done_outlined),
            title: const Text('Firebase status'),
            subtitle:
                Text(app.firebaseConnected ? 'Online' : 'Offline (using cache)'),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;
  const _SectionTitle({required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: Theme.of(context).textTheme.titleMedium,
      ),
    );
  }
}
