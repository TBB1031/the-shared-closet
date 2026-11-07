# The Shared Closet

A first working full-stack version of a private, friend-group digital wardrobe.

## Included in this version

- Account registration and sign-in
- Private groups with invite codes
- Upload clothing and accessory photos
- Share each item with selected groups (or keep it private)
- Browse items shared with your groups
- Send borrowing requests with dates and a note
- Owner approval or decline
- Mark approved loans as returned
- Responsive desktop and mobile interface with a soft glass-inspired visual style

## Requirements

- Node.js 20 or newer
- npm

## Run locally

1. Unzip the project.
2. Open a terminal in the `the-shared-closet` folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the server:

   ```bash
   npm start
   ```

5. Visit [http://localhost:3000](http://localhost:3000).

Create two accounts in separate browsers (or one normal and one private/incognito window) to test sharing between people.

## Quick test

1. Create Account A.
2. Open **My groups**, create a group, and copy its invite code.
3. Sign out. Create Account B and join using the invite code.
4. Sign back into Account A, add an item, and select the group under **Share with groups**.
5. Sign into Account B and open **Friends' closets**.
6. Request the item with a date range.
7. Sign into Account A and open **Borrowing** to approve it.
8. Either account can mark the approved loan as returned.

## Important before public launch

This is a local MVP starter, not a production deployment. Before opening it to the public:

- Set a long, random `SESSION_SECRET` environment variable.
- Use HTTPS and set `NODE_ENV=production`.
- Replace local image uploads with managed object storage and add image scanning/processing.
- Use a production session store and configure session cookie settings for your domain.
- Add email verification, password reset, account deletion, reporting/blocking, and moderation.
- Add CSRF protection and more comprehensive request validation/rate limiting.
- Add clear borrowing rules, damage/loss policies, privacy controls, and community guidelines.
- Back up the database and test restore procedures.
- Review privacy, consumer protection, and liability requirements for your launch locations.

The current SQLite database and uploaded images are stored in `data/` and `uploads/` and are intentionally excluded from version control.
