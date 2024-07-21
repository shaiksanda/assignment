const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(8103, () => {
      console.log("Server Running at http://localhost:8103/");
      console.log("Database Connected Successfully");
    });
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const authenticateToken = (req, res, next) => {
  const authHeaders = req.headers["authorization"];
  if (authHeaders) {
    const jwtToken = authHeaders.split(" ")[1];
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", (error, payload) => {
      if (error) {
        res.status(401).send("Invalid JWT Token");
      } else {
        req.userId = payload.userId;
        req.username = payload.username;
        next();
      }
    });
  } else {
    res.status(401).send("Invalid JWT Token");
  }
};

app.post("/register/", async (req, res) => {
  const { username, password, name, gender } = req.body;
  const userQuery = `SELECT * FROM user WHERE username = ?`;
  const existingUser = await db.get(userQuery, username);

  if (existingUser) {
    res.status(400).send("User already exists");
  } else if (password.length < 6) {
    res.status(400).send("Password is too short");
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    const createUserQuery = `
      INSERT INTO user (username, password, name, gender)
      VALUES (?, ?, ?, ?)
    `;
    await db.run(createUserQuery, [username, hashedPassword, name, gender]);
    res.status(200).send("User created successfully");
  }
});

app.post("/login/", async (req, res) => {
  const { username, password } = req.body;
  const userQuery = `SELECT * FROM user WHERE username = ?`;
  const user = await db.get(userQuery, username);

  if (!user) {
    res.status(400).send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      res.status(400).send("Invalid password");
    } else {
      const payload = { username: user.username, userId: user.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      res.send({ jwtToken });
    }
  }
});

app.get("/user/tweets/feed/", authenticateToken, async (req, res) => {
  const { userId } = req;

  const query = `
    SELECT
      u.username,
      t.tweet,
      t.date_time AS dateTime
    FROM tweet t
    JOIN user u ON t.user_id = u.user_id
    WHERE u.user_id IN (
      SELECT following_user_id
      FROM follower
      WHERE follower_user_id = ?
    )
    ORDER BY t.date_time DESC
    LIMIT 4
  `;

  const tweets = await db.all(query, userId);
  res.send(tweets);
});

app.get("/user/following/", authenticateToken, async (req, res) => {
  const { userId } = req;
  console.log("Authenticated User ID:", userId); // Logging user ID

  const query = `SELECT user.name 
                 FROM follower 
                 INNER JOIN user 
                 ON user.user_id = follower.following_user_id 
                 WHERE follower.follower_user_id = ?`;
  try {
    const result = await db.all(query, userId);
    console.log("Query Result:", result); // Logging query result
    res.send(result);
  } catch (error) {
    console.error("Error executing query:", error);
    res.status(500).send("Internal Server Error");
  }
});

//Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticateToken, async (req, res) => {
  const { userId } = req;
  const query = `select user.name from user inner join follower on user.user_id=follower.follower_user_id where follower.following_user_id=?`;
  let result = await db.all(query, userId);
  res.send(result);
});

//api 6

app.get("/tweets/:tweetId/", authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;

  // Retrieve the tweet and its author
  const tweetQuery = `
    SELECT user_id AS tweet_author_id, tweet, date_time
    FROM tweet
    WHERE tweet_id = ?;
  `;
  const tweet = await db.get(tweetQuery, tweetId);

  // Scenario 1: If the user is not following the tweet author
  if (tweet) {
    const followingQuery = `
      SELECT 1
      FROM follower
      WHERE follower_user_id = ?
        AND following_user_id = ?;
    `;
    const isFollowing = await db.get(
      followingQuery,
      userId,
      tweet.tweet_author_id
    );

    if (!isFollowing) {
      return res.status(401).send("Invalid Request");
    }

    // Scenario 2: If the user is following the tweet author
    const likesQuery = `
      SELECT COUNT(*) AS likes_count
      FROM like
      WHERE tweet_id = ?;
    `;
    const { likes_count } = await db.get(likesQuery, tweetId);

    const repliesQuery = `
      SELECT COUNT(*) AS replies_count
      FROM reply
      WHERE tweet_id = ?;
    `;
    const { replies_count } = await db.get(repliesQuery, tweetId);

    res.send({
      tweet: tweet.tweet,
      likes: likes_count,
      replies: replies_count,
      dateTime: tweet.date_time,
    });
  } else {
    // Tweet not found, should handle this case if needed
    res.status(404).send("Tweet not found");
  }
});

//api 7
app.get("/tweets/:tweetId/likes/", authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;
  const tweetQuery = `select user_id as tweet_author_id from tweet where tweet_id=?`;
  const tweet = await db.get(tweetQuery, tweetId);
  if (tweet) {
    const followingQuery = `select 1 from follower where follower_user_id=? and following_user_id=?`;
    const isFollowing = await db.get(
      followingQuery,
      userId,
      tweet.tweet_author_id
    );
    if (!isFollowing) {
      return res.status(401).send("Invalid Request");
    }
    const likesQuery = `
      SELECT user.username
      FROM like
      INNER JOIN user ON user.user_id = like.user_id
      WHERE like.tweet_id = ?
    `;
    const likes = await db.all(likesQuery, tweetId);
    res.send({ likes: likes.map((row) => row.username) });
  }
});

//api 8

app.get("/tweets/:tweetId/replies/", authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;

  try {
    // Retrieve the tweet and its author
    const tweetQuery = `
      SELECT user_id AS tweet_author_id
      FROM tweet
      WHERE tweet_id = ?;
    `;
    const tweet = await db.get(tweetQuery, tweetId);

    // Check if the tweet exists
    if (!tweet) {
      return res.status(404).send("Tweet not found");
    }

    // Check if the user is following the tweet's author
    const followingQuery = `
      SELECT 1
      FROM follower
      WHERE follower_user_id = ? AND following_user_id = ?;
    `;
    const isFollowing = await db.get(
      followingQuery,
      userId,
      tweet.tweet_author_id
    );

    if (!isFollowing) {
      return res.status(401).send("Invalid Request");
    }

    // Retrieve the replies to the tweet
    const replyQuery = `
      SELECT user.name, reply.reply
      FROM reply
      JOIN user ON user.user_id = reply.user_id
      WHERE reply.tweet_id = ?;
    `;
    const replies = await db.all(replyQuery, tweetId);

    // Send the response in the expected format
    res.send({
      replies: replies.map((each) => ({
        name: each.name,
        reply: each.reply,
      })),
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

//Returns a list of all tweets of the user

app.get("/user/tweets/", authenticateToken, async (req, res) => {
  const { userId } = req;
  const tweetsQuery = `
      SELECT 
        tweet.tweet AS tweet, 
        tweet.date_time AS dateTime,
        (SELECT COUNT(*) FROM like WHERE tweet_id = tweet.tweet_id) AS likes,
        (SELECT COUNT(*) FROM reply WHERE tweet_id = tweet.tweet_id) AS replies
      FROM tweet
      WHERE user_id = ?
      
    `;
  const tweets = await db.all(tweetsQuery, userId);
  res.send(
    tweets.map((tweet) => ({
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: tweet.replies,
      dateTime: tweet.dateTime,
    }))
  );
});

//Create a tweet in the tweet table

app.post("/user/tweets/", authenticateToken, async (req, res) => {
  const { userId } = req;
  const { tweet } = req.body;

  const postQuery = `insert into tweet(tweet,user_id,date_time) values(?,?,?)`;
  const dateTime = new Date().toISOString().slice(0, 19).replace("T", " ");
  db.run(postQuery, [tweet, userId, dateTime]);
  res.send("Created a Tweet");
});

//api 11

app.delete("/tweets/:tweetId", authenticateToken, async (req, res) => {
  const { tweetId } = req.params;
  const { userId } = req;

  try {
    // Query to get the tweet information
    const tweetQuery = `SELECT user_id FROM tweet WHERE tweet_id = ?`;
    const tweet = await db.get(tweetQuery, tweetId);

    // Log the tweet and userId for debugging
    console.log("Tweet:", tweet);
    console.log("UserId:", userId);

    // Check if tweet exists
    if (!tweet) {
      console.log("Tweet not found in the database.");
      return res.status(404).send("Tweet not found");
    }

    // Check if the user is the owner of the tweet
    if (tweet.user_id !== userId) {
      console.log("User is not the owner of the tweet.");
      return res.status(401).send("Invalid Request");
    }

    // Query to delete the tweet
    const deleteQuery = `DELETE FROM tweet WHERE tweet_id = ?`;
    await db.run(deleteQuery, tweetId);

    res.send("Tweet Removed");
  } catch (error) {
    // Log the error and respond with a generic error message
    console.error("Error deleting tweet:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = app;
