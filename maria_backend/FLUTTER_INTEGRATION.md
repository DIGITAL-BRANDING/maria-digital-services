# Flutter Integration Notes

Your Flutter app currently sends provider credentials from `DioClient`:

```dart
'api-token': AppConfig.apiToken,
'Authorization': 'Token ${AppConfig.apiToken}',
```

For production, remove those provider headers from the mobile app. The app should call your backend only, and the backend should call Alrahuz.

## 1. Point Flutter to the backend

For Android emulator:

```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8787/api
```

For a physical phone:

```bash
flutter run --dart-define=API_BASE_URL=http://YOUR_PC_LAN_IP:8787/api
```

## 2. Send Firebase ID token to backend

Update `lib/core/network/interceptors/auth_interceptor.dart` so every Dio request includes the signed-in Firebase user's ID token:

```dart
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';

class AuthInterceptor extends Interceptor {
  AuthInterceptor();

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    return handler.next(options);
  }
}
```

Then update the constructor usage in `DioClient` to match.

## 3. Remove provider token from Flutter

In `lib/core/network/dio_client.dart`, remove:

```dart
'api-token': AppConfig.apiToken,
'Authorization': 'Token ${AppConfig.apiToken}',
```

The backend `.env` should hold:

```bash
ALRAHUZ_API_TOKEN=your_real_provider_token
```

## 4. Recommended endpoint order

Start with these because the app already depends on them:

- `GET /api/user/profile`
- `POST /api/user/pin/set`
- `POST /api/user/pin/verify`
- `GET /api/wallet/balance`
- `GET /api/wallet/virtual-account`
- `GET /api/data/plans/:network`
- `POST /api/data/purchase`
- `POST /api/airtime/purchase`
- `GET /api/transactions`

After that, add payment webhooks, cable, electricity, KYC, support tickets, referrals, and admin dashboard routes.
