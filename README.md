# SmartPark — QR parking and timed bookings

This is an update to the existing Smart Parking project. It keeps the React/Vite frontend, Express API, MongoDB storage, QR-code flow, customer accounts and admin dashboard.

## What this version does

### QR availability
- Admin can generate and download one entrance QR code for each property.
- Scanning a property's QR opens its availability dashboard directly.
- The dashboard shows total, available and booked spaces across the property, plus the selected level's slot grid.
- Availability refreshes from MongoDB-backed API data every five seconds.

### Guest bookings and parking timer
- Customers can view availability and book without signing in.
- Booking starts immediately when the customer confirms a slot.
- Durations are 30 minutes, 1 hour, 2 hours, 3 hours or a custom duration from 30 minutes to 12 hours in 30-minute steps.
- Customers can extend an active booking by 30 minutes, 1 hour or 2 hours.
- Customers can end parking early; the slot is then released immediately.
- If the timer reaches its end, the backend expires the booking and releases the slot automatically. The backend also checks for expired bookings on API reads and every 15 seconds.
- Guest booking credentials are stored as a hash in MongoDB; the one-time guest token is kept in that browser's local storage so the guest can extend or end their booking.
- When a guest later logs in or registers in the same browser, their saved guest bookings are claimed and added to their account history.

### Accounts and admin
- Login/signup is optional for booking, but required to view account-wide booking history.
- Passwords are hashed with bcrypt and login uses a signed, HTTP-only cookie.
- Admin APIs require an account with the `admin` role.
- The first admin account is created from backend environment variables.

### Availability rules
- There is no camera-based vehicle detection, IoT sensor or staff occupancy update.
- A slot is marked booked while it has an active SmartPark booking.
- When the customer ends the booking or its timer expires, the slot becomes available again.
- The initial demo seed starts with every slot available. Existing demo data is normalized at backend startup: old randomly occupied slots are cleared, while slots belonging to active confirmed bookings remain booked.
- Initial GVK One, Sarath City and Apollo parking layouts are illustrative demo layouts, not verified official bay-by-bay maps or capacity claims. Replace them with property-approved counts before a real deployment.

## Requirements
- Node.js 20 or later (Node 26 is fine).
- A MongoDB Atlas cluster or reachable MongoDB server.
- VS Code / PowerShell.

## 1. Configure MongoDB

1. Create a MongoDB Atlas cluster.
2. Create a database user and password in **Database Access**.
3. In **Network Access**, allow the IP address of the computer running the backend. Avoid opening access to everyone unless you understand the security trade-off.
4. In Atlas, select **Connect → Drivers**, copy the connection string and replace the username/password placeholders. Use a database name such as `smartpark`.

## 2. Configure the backend

Open a PowerShell terminal in the `smart-parking-system` folder:

```powershell
cd backend
Copy-Item .env.example .env
```

Open `backend/.env` and set:
- `MONGODB_URI` to your real Atlas connection string.
- `JWT_SECRET` to a random secret of at least 32 characters.
- `ADMIN_EMAIL` to the email you want to use for admin login.
- `ADMIN_PASSWORD` to a strong admin password.
- `FRONTEND_URL` to `http://localhost:5173` for local development.

Then run:

```powershell
npm install
npm run dev
```

Wait for `Connected to MongoDB.` and `Smart Parking API listening on http://localhost:5000`.

If the backend reports `querySrv ENOTFOUND`, check that the Atlas hostname in `MONGODB_URI` is copied exactly, your computer has internet/DNS access, and the Atlas network access list allows your current IP address.

## 3. Configure the frontend

Open a second PowerShell terminal in the project root:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open the Vite URL, usually `http://localhost:5173`.

## 4. Test the project

1. Open the website and check that the three demo properties load.
2. Select a property or scan its entrance QR. Confirm the dashboard shows total, available and booked spaces.
3. Select an available slot and book for 30 minutes. You should receive a booking reference without logging in.
4. In the guest booking card, test `+30 min`, then `End parking`. Confirm the slot becomes available again.
5. Book again and allow the booking timer to expire. The backend should release the slot automatically.
6. Register or log in in the same browser. Guest bookings saved in that browser should be linked to the account and visible in **My bookings**.
7. Log in using the admin account from `backend/.env` to manage properties and download entrance QR codes.
8. Open the same site in two browser sessions and verify a booked slot appears unavailable in the other session after the next refresh.
9. From the frontend folder, run `npm run build`.

## Deployment notes

For deployment, host the frontend and backend over HTTPS. Set the frontend `VITE_API_URL` to the deployed backend API URL and `VITE_PUBLIC_APP_URL` to the public frontend URL before building. Set backend `FRONTEND_URL` to the exact deployed frontend origin, `NODE_ENV=production`, `MONGODB_URI`, and a strong `JWT_SECRET`. Configure secrets in the hosting provider's environment settings; never upload `.env` files or credentials to GitHub.

## Demo limitations

- Availability is booking-based, not sensor-verified physical occupancy. If a customer leaves but does not press **End parking**, their slot stays reserved until the timer expires.
- The timer starts immediately after booking confirmation. This version does not support future-dated reservations.
- Guest booking management is tied to the browser that made the booking until the user signs in and claims those bookings.
- The initial property slot layouts are illustrative and need approval/verification by each property before public use.
- Before real public/commercial use, add payment handling if required, stronger audit logging, operational monitoring, backups, verified property data and a formal security review.
