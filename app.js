/*
 * Copyright (c) Microsoft. All rights reserved. Licensed under the MIT license.
 * See LICENSE in the project root for license information.
 */

/*
 * This sample uses an open source OAuth 2.0 library that is compatible with the Azure AD v2.0 endpoint.
 * Microsoft does not provide fixes or direct support for this library.
 * Refer to the library’s repository to file issues or for other support.
 * For more information about auth libraries see:
 * https://azure.microsoft.com/documentation/articles/active-directory-v2-libraries/
 * Library repo:  https://github.com/jaredhanson/passport
 */

'use strict';
// set up ======================================================================
const express = require('express');
const session = require('express-session');
const port = process.env.PORT || 3000;
const http = require('http');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;
const emailHelper = require('./utils/emailHelper.js');
const config = require('./utils/config.js');
const graphHelper = require('./utils/graphHelper.js');
const graph = require('@microsoft/microsoft-graph-client');

const app = express();
const server = http.createServer(app);

// **IMPORTANT
// Note that you will need to create a self-signed cert and use a secure server.
// Below is an example after you have the key cert pair:
// const https = require('https');
// const certConfig = {
// 	key: fs.readFileSync('./utils/cert/server.key', 'utf8'),
// 	cert: fs.readFileSync('./utils/cert/server.crt', 'utf8')
// };
// const server = https.createServer(certConfig, app);

// authentication =================================================================
var callback = (iss, sub, profile, accessToken, refreshToken, done) => {
  if (!profile.oid) {
    return done(new Error("No oid found"), null);
  }

  findByOid(profile.oid, function(err, user){
    if (err) {
      return done(err);
    }

    if (!user) {
      users.push({profile, accessToken, refreshToken});
      return done(null, profile);
    }

    return done(null, user);
  });
};

passport.use(new OIDCStrategy(config.creds, callback));

const users = [];

passport.serializeUser((user, done) => {
  done(null, user.oid);
});

passport.deserializeUser((id, done) => {
  findByOid(id, function (err, user) {
    done(err, user);
  });
});

var findByOid = function(oid, fn) {
  for (var i = 0, len = users.length; i < len; i++) {
    var user = users[i];
    if (user.profile.oid === oid) {
      return fn(null, user);
    }
  }
  return fn(null, null);
};

// configuration ===============================================================
app.use(express.static(__dirname + '/public'));
app.use(morgan('dev'));
app.use(bodyParser.urlencoded({'extended':'true'}));
app.use(bodyParser.json());
app.use(methodOverride());
app.set('view engine', 'pug');
app.use(cookieParser());
app.use(session({
  secret: 'sshhhhhh',
  name: 'graphNodeCookie',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());


// application =================================================================
app.get('/', function(req, res){
  if (req.isAuthenticated()) {
    var userEmail = req.user.email;
    if (userEmail === undefined) {
      graphHelper.getUserEmail(req.user, function(err, email){
        if (email)
        {
          userEmail = email;
          // Update user in cache
          var userIndex = users.findIndex((obj => obj.profile.oid == req.user.profile.oid));
          users[userIndex]["email"] = email;

          res.render('emailSender', { user: req.user.profile, email: userEmail });
        }
      });
    } else {
      res.render('emailSender', { user: req.user.profile, email: userEmail });
    }
  } else {
    res.render('login');
  }
});

app.get('/login',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect',
    {
      response: res,
      failureRedirect: '/'
    })(req, res, next);
  },
  function (req, res) {
    res.redirect('/');
  });

app.get('/token',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect',
      {
        response: res,
        failureRedirect: '/'
      }
    )(req, res, next);
  },
  function (req, res) {
    res.redirect('/');
  });

app.post('/emailSender',
  ensureAuthenticated,
  (req, res) => {
    const mailBody = emailHelper.generateMailBody(req.user.profile.displayName, req.body.input_email);

    graphHelper.sendEmail(req.user, mailBody, function(err) {
      if (err) {
        renderError(res, err);
        return;
      }

      console.log("Sent an email");
      res.render('emailSender', { user: req.user.profile, status: "success"});
    });
});

app.get('/logout', (req, res) => {
  // Remove user from cache
  users.splice(
    users.findIndex((obj => obj.profile.oid == req.user.profile.oid)), 1);
  req.session.destroy( (err) => {
    req.logOut();
  res.clearCookie('graphNodeCookie');
  res.status(200);
  res.redirect('http://localhost:' + port);
  });
});

// listen (start app with node app.js) ======================================
server.listen(port);
console.log("Magic happens here: http://localhost:" + port);

function ensureAuthenticated (req, res, next) {
    if (req.isAuthenticated()) { return next(); }

    res.render('/login');
};

// error handling ===========================================================
function renderError (res, e) {
  res.render('error', {
    message: e.message,
    error: e
  });
  console.error(e);
};
