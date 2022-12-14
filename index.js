const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken');

require('colors')
require('dotenv').config()

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express()
const port = process.env.PORT || 5000;

//middlewares
app.use(cors())
app.use(express.json())


//uri & client
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.preca8g.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


//db connection function
async function run() {
    try {
        client.connect()
        console.log('Database connected succesfully'.yellow.bold);
    }
    catch (error) {
        console.log(error.message.red.bold);
    }
}
run().catch(err => console.log(err.message.red.bold))

//collections
const appointmentOptionsCollections = client.db('doctorsPortal').collection('appointmentOptions')
const bookingsCollection = client.db('doctorsPortal').collection('bookings')
const usersCollection = client.db('doctorsPortal').collection('users')
const doctorsCollection = client.db('doctorsPortal').collection('doctors')
const paymentsCollection = client.db('doctorsPortal').collection('payments')

//common funcions 

//1
function verifyJwt(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' })
    }

    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded
        next()
    })
}

//2 (N.B: verify admin middleware should be call after verifyJWT)
const verifyAdmin = async (req, res, next) => {
    const decodedEmail = req.decoded.email
    const query = { email: decodedEmail }
    const user = await usersCollection.findOne(query)
    if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' })
    }
    next()
}



//api's / endspoints

//root api
app.get('/', (req, res) => {
    res.send('doctors-portal-server is running')
})

//api for get appointment options
app.get('/appointmentOptions', async (req, res) => {
    try {
        //taking date
        const date = req.query.date
        //taking both collection
        const query = {}
        const options = await appointmentOptionsCollections.find(query).toArray();
        const bookingQuery = { appointmentDate: date }
        const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray()
        //nested loop for unbooked slots for pariculer teatment on a particuler date.
        options.forEach(option => {
            //filtering the partculer booked treatment.
            const optionBooked = alreadyBooked.filter(book => book.Treatment === option.name)
            //filtering the booked slots.
            const bookedSlot = optionBooked.map(book => book.slot)
            //filtering the unbooked(remaining slots)
            const remainingSlots = option.slots.filter(slot => !bookedSlot.includes(slot))
            option.slots = remainingSlots;
        })
        res.send(options)
    }
    catch (error) {
        res.send(error.message)
    }
})

//api for get appointment options(with mongodb aggregate)
app.get('/v2/appointmentOptions', async (req, res) => {
    try {
        const date = req.query.date
        const options = await appointmentOptionsCollections.aggregate([
            {
                $lookup: {
                    from: 'bookings',
                    localField: 'name',
                    foreignField: 'Treatment',
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$appointmentDate', date]
                                }
                            }
                        },
                    ],
                    as: 'booked'
                }
            },
            {
                $project: {
                    name: 1,
                    price: 1,
                    slots: 1,
                    booked: {
                        $map: {
                            input: '$booked',
                            as: 'book',
                            in: '$$book.slot'
                        }
                    }
                }
            },
            {
                $project: {
                    name: 1,
                    price: 1,
                    slots: {
                        $setDifference: ['$slots', '$booked']
                    }
                }
            }
        ]).toArray()
        res.send(options)
    }
    catch (error) {

    }
})

//api for posting single bookings of client
app.post('/bookings', async (req, res) => {
    try {
        const booking = req.body
        const query = {
            appointmentDate: booking.appointmentDate,
            Treatment: booking.Treatment,
            email: booking.email
        }
        const BookingCount = await bookingsCollection.find(query).toArray()
        if (BookingCount.length) {
            const message = `You already have a booking on ${booking.appointmentDate}`
            return res.send({ acknowledged: false, message })
        }
        const result = await bookingsCollection.insertOne(booking)
        res.send(result)
    }
    catch (error) {
        console.log(error);
        res.send(error.message)
    }
})

//api for getting all booking of a particuler client/user.
app.get('/bookings', verifyJwt, async (req, res) => {
    try {
        const email = req.query.email
        const decodedEmail = req.decoded.email
        if (email !== decodedEmail) {
            return res.status(403).send({ message: 'forbidden access' })
        }
        const query = { email: email }
        const userBookings = await bookingsCollection.find(query).toArray()
        res.send(userBookings)
    }
    catch (error) {
        res.send(error.message)
    }
})

//api for posting user info in db
app.post('/users', async (req, res) => {
    try {
        const user = req.body
        const result = await usersCollection.insertOne(user)
        res.send(result)
    }
    catch (error) {
        res.send(error.message)
    }
})

//api for getting all user info from db
app.get('/users', async (req, res) => {
    try {
        const query = {}
        const users = await usersCollection.find(query).toArray()
        res.send(users)
    }
    catch (error) {
        res.send(error.message)
    }
})

//api for getting single user info from db
app.get('/users/admin/:email', async (req, res) => {
    try {
        const email = req.params.email
        const query = { email }
        const user = await usersCollection.findOne(query)
        res.send({ isAdmin: user?.role === 'admin' })
    }
    catch (error) {
        res.send(error.message)
    }
})

//api for updatin user info in db
app.put('/users/admin/:id', verifyJwt, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id
        const filter = { _id: ObjectId(id) }
        const option = { upsert: true }
        const updatedDoc = { $set: { role: 'admin' } }
        const result = await usersCollection.updateOne(filter, updatedDoc, option)
        res.send(result)
    }
    catch (error) {
        res.send(error.message)
    }
})

//api for issue a access token
app.get('/jwt', async (req, res) => {
    try {
        const email = req.query.email
        const query = { email: email }
        const user = await usersCollection.findOne(query)
        if (user) {
            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' })
            return res.send({ accessToken: token })
        }
        res.status(403).send({ accessToken: '' })
    }
    catch (error) {
        res.send({ message: error.message })
    }
})

//api for getting only appointments names
app.get('/appointmentSpecialty/', async (req, res) => {
    try {
        const query = {}
        const result = await appointmentOptionsCollections.find(query).project({ name: 1 }).toArray()
        res.send(result)
    }
    catch (error) {
        res.send({ message: error.message })
    }
})

//api for posting dotors data in database
app.post('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
    try {
        const doctor = req.body
        const result = await doctorsCollection.insertOne(doctor)
        res.send(result)
    } catch (error) {
        res.send({ message: error.message })
    }
})
//api for getting dotors data in database
app.get('/doctors', verifyJwt, verifyAdmin, async (req, res) => {
    try {
        const query = {}
        const doctors = await doctorsCollection.find(query).toArray()
        res.send(doctors)
    } catch (error) {
        res.send({ message: error.message })
    }
})

//api for deleting dotors data in database
app.delete('/doctors/:id', verifyJwt, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id
        const query = { _id: ObjectId(id) }
        const result = await doctorsCollection.deleteOne(query)
        res.send(result)
    } catch (error) {
        res.send({ message: error.message })
    }
})

// temporary to update price field to appointment options.
// app.get('/addPrice', async (req, res) => {
//     try {
//         const filter = {}
//         const option = { upsert: true }
//         const updatedDoc = {
//             $set: {
//                 price: 99
//             }
//         }
//         const result = await appointmentOptionsCollections.updateMany(filter, updatedDoc, option)
//         res.send(result)
//     }
//     catch (error) {
//         res.send({ message: error.message })
//     }
// })

//api for getting a specific booking
app.get('/booking/:id', async (req, res) => {
    try {
        const id = req.params.id
        query = { _id: ObjectId(id) }
        const booking = await bookingsCollection.findOne(query)
        res.send(booking)
    }
    catch (error) {
        res.send({ message: error.message })
    }
})

//---------------payment task------------------

//api for payment gateway...
app.post('/create-payment-intent', async (req, res) => {
    try {
        const booking = req.body
        const price = booking.price
        const amount = price * 100

        const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            "payment_method_types": [
                "card"
            ],
        });
        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    }
    catch (error) {

    }
})

//api for store payments data
app.post('/payments', async (req, res) => {
    try {
        const payment = req.body
        const result = await paymentsCollection.insertOne(payment)
        const id = payment.bookingId
        const filter = { _id: ObjectId(id) }
        const updateDoc = {
            $set: {
                paid: true,
                transactionId: payment.transactionId
            }
        }
        const updateResult = await bookingsCollection.updateOne(filter, updateDoc)
        res.send(result)

    }
    catch (error) {
        res.send({ message: result })
    }
})

app.listen(port, () => {
    console.log(`This server is running on ${port}`);
})