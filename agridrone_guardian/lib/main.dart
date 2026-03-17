import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:google_fonts/google_fonts.dart';

import 'providers/app_provider.dart';
import 'screens/home_screen.dart';
import 'screens/result_screen.dart';
import 'screens/soil_screen.dart';
import 'screens/settings_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const AgriDroneApp());
}

class AgriDroneApp extends StatelessWidget {
  const AgriDroneApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AppProvider()..init(),
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        title: 'AgriDrone Guardian',
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF2E7D32),
            primary: const Color(0xFF2E7D32),
            secondary: const Color(0xFF81C784),
            surface: const Color(0xFFF1F8E9),
          ),
          scaffoldBackgroundColor: const Color(0xFFF1F8E9),
          textTheme: GoogleFonts.poppinsTextTheme(),
          cardTheme: CardThemeData(
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(color: const Color(0xFF81C784).withOpacity(0.4)),
            ),
            elevation: 2,
          ),
        ),
        home: const AppShell(),
        routes: {
          SettingsScreen.route: (_) => const SettingsScreen(),
        },
      ),
    );
  }
}

class AppShell extends StatefulWidget {
  const AppShell({super.key});

  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int index = 0;

  final screens = const [
    HomeScreen(),
    ResultScreen(),
    SoilScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    final isWeb = width >= 600;

    return Scaffold(
      body: Row(
        children: [
          if (isWeb)
            NavigationRail(
              selectedIndex: index,
              onDestinationSelected: (i) => setState(() => index = i),
              backgroundColor: Colors.white,
              indicatorColor: const Color(0xFF81C784).withOpacity(0.3),
              labelType: NavigationRailLabelType.all,
              destinations: const [
                NavigationRailDestination(
                  icon: Icon(Icons.home_outlined),
                  selectedIcon: Icon(Icons.home),
                  label: Text('Home'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.analytics_outlined),
                  selectedIcon: Icon(Icons.analytics),
                  label: Text('Results'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.water_drop_outlined),
                  selectedIcon: Icon(Icons.water_drop),
                  label: Text('Soil'),
                ),
              ],
            ),
          Expanded(child: screens[index]),
        ],
      ),
      bottomNavigationBar: isWeb
          ? null
          : NavigationBar(
              selectedIndex: index,
              onDestinationSelected: (i) => setState(() => index = i),
              destinations: const [
                NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
                NavigationDestination(
                    icon: Icon(Icons.analytics), label: 'Results'),
                NavigationDestination(
                    icon: Icon(Icons.water_drop), label: 'Soil'),
              ],
            ),
    );
  }
}
