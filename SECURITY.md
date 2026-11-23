# Security

## Reporting a security problem

Please **don't open a public issue** for a security problem. Email the repository owner instead, at the address on their GitHub profile (github.com/xX772037). Say what you found, how to reproduce it, and what someone could do with it. You'll get a reply as soon as possible, and the problem will be fixed before it's discussed in public.

## Where records are kept

SprayLedger has no server and no accounts. Spray records, flight logs and customer details stay in the browser on the device that entered them (IndexedDB), and leave it only when the user downloads, shares or exports them. The app contacts only the outside services listed in the README (map pictures, weather and county parcel data), and sends them map positions, the field's location (and, when looking up past weather, the job's date) or an address typed into the search box, never the records themselves.
