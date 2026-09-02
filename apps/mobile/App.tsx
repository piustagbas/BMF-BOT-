import React from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { NavigationContainer, DarkTheme, useNavigation } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { MemecoinAutoTradeProvider } from './src/settings/MemecoinAutoTradeContext';
import { WalletProvider } from './src/wallet/WalletContext';
import { BetSlipProvider, useBetSlip } from './src/bet/BetSlipContext';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { SignalsScreen } from './src/screens/SignalsScreen';
import { WatchlistScreen } from './src/screens/WatchlistScreen';
import { MoreScreen } from './src/screens/MoreScreen';
import { PaperScreen } from './src/screens/PaperScreen';
import { TradeScreen } from './src/screens/TradeScreen';
import { BacktestScreen } from './src/screens/BacktestScreen';
import { OutcomesScreen } from './src/screens/OutcomesScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { SmartMoneyScreen } from './src/screens/SmartMoneyScreen';
import { TokenDetailsScreen } from './src/screens/TokenDetailsScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { TradeHistoryScreen } from './src/screens/TradeHistoryScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { NotificationBell } from './src/components/NotificationBell';
import { BetBotHomeScreen } from './src/screens/bet/BetBotHomeScreen';
import { BetFixtureScreen } from './src/screens/bet/BetFixtureScreen';
import { BetSlipScreen } from './src/screens/bet/BetSlipScreen';
import { BetVerifyScreen } from './src/screens/bet/BetVerifyScreen';
import { ForexBotHomeScreen } from './src/screens/forex/ForexBotHomeScreen';
import { ForexSignalScreen } from './src/screens/forex/ForexSignalScreen';
import { BetBotFab } from './src/components/BetBotFab';
import { ForexBotFab } from './src/components/ForexBotFab';
import { AppLogo, BrandHeaderTitle } from './src/components/AppLogo';
import { colors } from './src/theme';
import type {
  BetBotStackParamList,
  ForexBotStackParamList,
  MoreStackParamList,
  RootStackParamList,
} from './src/navigation/types';

const Tab = createBottomTabNavigator();
const RootStack = createNativeStackNavigator<RootStackParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();
const BetStack = createNativeStackNavigator<BetBotStackParamList>();
const ForexStack = createNativeStackNavigator<ForexBotStackParamList>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.accent,
  },
};

function MoreStackNavigator() {
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <MoreStack.Screen
        name="MoreHome"
        component={MoreScreen}
        options={{ title: 'More' }}
      />
      <MoreStack.Screen name="Paper" component={PaperScreen} options={{ title: 'Demo' }} />
      <MoreStack.Screen name="Trade" component={TradeScreen} options={{ title: 'Trade' }} />
      <MoreStack.Screen
        name="Backtest"
        component={BacktestScreen}
        options={{ title: 'Backtest' }}
      />
      <MoreStack.Screen
        name="Outcomes"
        component={OutcomesScreen}
        options={{ title: 'BUY results' }}
      />
      <MoreStack.Screen
        name="SmartMoney"
        component={SmartMoneyScreen}
        options={{ title: 'Smart money' }}
      />
      <MoreStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Settings' }}
      />
    </MoreStack.Navigator>
  );
}

function Tabs() {
  const insets = useSafeAreaInsets();
  // Samsung 3-button nav (Back / Home / Recents) sits under a fixed-height tab bar.
  // Use the system inset; if Android reports 0 (edge-to-edge quirk), keep a button-row gap.
  const bottomInset =
    insets.bottom > 0 ? insets.bottom : Platform.OS === 'android' ? 48 : 8;
  const tabBarBody = 52;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: tabBarBody + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarIcon: ({ color, size }) => {
          const map: Record<string, keyof typeof Ionicons.glyphMap> = {
            Home: 'grid-outline',
            Scanner: 'search-outline',
            Signals: 'flash-outline',
            Watchlist: 'star-outline',
            More: 'ellipsis-horizontal',
          };
          return (
            <Ionicons
              name={map[route.name] ?? 'ellipse-outline'}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={DashboardScreen}
        options={{
          title: 'Home',
          headerTitle: () => <BrandHeaderTitle />,
          headerRight: () => <NotificationBell />,
        }}
      />
      <Tab.Screen name="Scanner" component={ScannerScreen} />
      <Tab.Screen name="Signals" component={SignalsScreen} />
      <Tab.Screen name="Watchlist" component={WatchlistScreen} />
      <Tab.Screen
        name="More"
        component={MoreStackNavigator}
        options={{ headerShown: false }}
      />
    </Tab.Navigator>
  );
}

function TabsWithFab() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const slip = useBetSlip();
  return (
    <View style={{ flex: 1 }}>
      <Tabs />
      <ForexBotFab onPress={() => navigation.navigate('ForexBot')} />
      <BetBotFab
        count={slip.selections.length || undefined}
        onPress={() => navigation.navigate('BetBot')}
      />
    </View>
  );
}

function CoinsBackButton() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Pressable
      onPress={() => {
        const parent = navigation.getParent();
        if (parent?.canGoBack()) parent.goBack();
        else navigation.navigate('Tabs');
      }}
      hitSlop={12}
      style={{ paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' }}
    >
      <Ionicons name="chevron-back" size={22} color={colors.text} />
      <Text style={{ color: colors.text, fontWeight: '700', marginLeft: 2 }}>Coins</Text>
    </Pressable>
  );
}

function BetBotStackNavigator() {
  return (
    <BetStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <BetStack.Screen
        name="BetHome"
        component={BetBotHomeScreen}
        options={{ title: 'BET BOT', headerLeft: () => <CoinsBackButton />, headerBackVisible: false }}
      />
      <BetStack.Screen
        name="BetFixture"
        component={BetFixtureScreen}
        options={{ title: 'Fixture' }}
      />
      <BetStack.Screen name="BetSlip" component={BetSlipScreen} options={{ title: 'Bet slip' }} />
      <BetStack.Screen
        name="BetVerify"
        component={BetVerifyScreen}
        options={{ title: 'Verify ticket' }}
      />
    </BetStack.Navigator>
  );
}

function ForexBotStackNavigator() {
  return (
    <ForexStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <ForexStack.Screen
        name="ForexHome"
        component={ForexBotHomeScreen}
        options={{ title: 'FX BOT', headerLeft: () => <CoinsBackButton />, headerBackVisible: false }}
      />
      <ForexStack.Screen
        name="ForexSignal"
        component={ForexSignalScreen}
        options={({ route }) => ({ title: route.params.symbol })}
      />
    </ForexStack.Navigator>
  );
}

function RootNavigator() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
        }}
      >
        <AppLogo size={96} />
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <RootStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <RootStack.Screen
        name="Tabs"
        component={TabsWithFab}
        options={{ headerShown: false }}
      />
      <RootStack.Screen
        name="TokenDetails"
        component={TokenDetailsScreen}
        options={{ title: 'Token', presentation: 'card' }}
      />
      <RootStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ title: 'Notifications' }}
      />
      <RootStack.Screen
        name="Portfolio"
        component={PortfolioScreen}
        options={{ title: 'Portfolio' }}
      />
      <RootStack.Screen
        name="TradeHistory"
        component={TradeHistoryScreen}
        options={{ title: 'Trade history' }}
      />
      <RootStack.Screen
        name="BetBot"
        component={BetBotStackNavigator}
        options={{ headerShown: false, presentation: 'card' }}
      />
      <RootStack.Screen
        name="ForexBot"
        component={ForexBotStackNavigator}
        options={{ headerShown: false, presentation: 'card' }}
      />
    </RootStack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MemecoinAutoTradeProvider>
          <WalletProvider>
            <BetSlipProvider>
              <NavigationContainer theme={navTheme}>
                <StatusBar style="light" />
                <RootNavigator />
              </NavigationContainer>
            </BetSlipProvider>
          </WalletProvider>
        </MemecoinAutoTradeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
