const wbm = require('wbm');

wbm.start().then(async () => {
    const contacts = [
        { phone: '+91 9098835618', name: 'Harsh', group: 'friend' }
    ];
    for (contact of contacts) {
        let message = 'hi';
        if(contact.group === 'customer') {
            message = 'Hello dear otp is ' + contact.name;
        }
        else if(contact.group === 'friend') {
            message = 'Hey ' + contact.name + '. Wassup?';
        }
        await wbm.sendTo(contact.phone, message);
    }
    await wbm.end();
}).catch(err => console.log(err));