require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const authRoutes = require('./routes/auth');
const webhookRoutes = require('./routes/webhooks');
const dashboardRoutes = require('./routes/dashboard');
const productsRoutes = require('./routes/products');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use('/', authRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/api', productsRoutes);

app.get('/', (req, res) => {
  res.redirect('/app' + (Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : ''));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LF Dropship App running on http://localhost:${PORT}`);
  console.log(`Install URL: ${process.env.APP_URL}/auth/install`);
});
