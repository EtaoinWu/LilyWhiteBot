const { Level } = require('level')

const namedb = new Level('./name_db/', { valueEncoding: 'json' })

async function get_name(uid) {
    try {
        return await namedb.get(uid)
    } catch (err) {
        return undefined
    }
}

async function set_name(uid, nick) {
    return await namedb.put(uid, nick)
}

module.exports = {
  namedb,
  get_name,
  set_name
}
