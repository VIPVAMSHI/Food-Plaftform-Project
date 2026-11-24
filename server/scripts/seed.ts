import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { places } from '../../src/data/places.ts'

/**
 * Builds server/data/bite.db from the restaurant list in src/data/places.ts.
 * Safe to run again: it replaces the places rows and leaves other tables alone.
 */
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/bite.db')
const migrationPath = resolve(import.meta.dirname, '../src/db/migrations/001_places.sql')

mkdirSync(dirname(databasePath), { recursive: true })

const db = new DatabaseSync(databasePath)
db.exec('PRAGMA foreign_keys = ON')
db.exec(readFileSync(migrationPath, 'utf8'))

const insert = db.prepare(`
  INSERT INTO places (
    id, name, cuisine, price, serving, neighborhood, address, street,
    miles, wait_minutes, rating, image, note, dishes
  ) VALUES (
    :id, :name, :cuisine, :price, :serving, :neighborhood, :address, :street,
    :miles, :wait, :rating, :image, :note, :dishes
  )
`)

db.exec('BEGIN')
db.exec('DELETE FROM places')
for (const place of places) {
  insert.run({
    id: place.id,
    name: place.name,
    cuisine: place.cuisine,
    price: place.price,
    serving: place.serving,
    neighborhood: place.neighborhood,
    address: place.address,
    street: place.street,
    miles: place.miles,
    wait: place.wait,
    rating: place.rating,
    image: place.image,
    note: place.note,
    dishes: JSON.stringify(place.dishes),
  })
}
db.exec('COMMIT')

const row = db.prepare('SELECT COUNT(*) AS count FROM places').get() as { count: number }
console.log(`Seeded ${row.count} restaurants into ${databasePath}`)
db.close()
