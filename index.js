const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')

require('colors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000;


app.get('/', (req, res) => {
    res.send('doctors-portal-server is running')
})

app.listen(port, () => {
    console.log(`This server is running on ${port}`);
})