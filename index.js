const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')

require('colors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000;

//middlewares
app.use(cors())
app.use(express.json())

//database code

//uri & client
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.preca8g.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

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

app.listen(port, () => {
    console.log(`This server is running on ${port}`);
})