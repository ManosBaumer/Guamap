import Jimp from 'jimp';

async function main() {
  try {
    const image = await Jimp.read('public/logo.png');
    // logo.png might have black text/icon. We'll change all dark pixels to white.
    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      const a = this.bitmap.data[idx + 3];

      // If it's not fully transparent, let's just color it white.
      // Assuming the logo is mainly one color (black). If it's a black/transparent logo, 
      // making every non-transparent pixel white will work perfectly.
      if (a > 10) {
        this.bitmap.data[idx + 0] = 255;
        this.bitmap.data[idx + 1] = 255;
        this.bitmap.data[idx + 2] = 255;
      }
    });

    // Resize to a standard favicon size (optional, but 64x64 is good)
    image.resize(64, Jimp.AUTO);

    await image.writeAsync('public/favicon.png');
    console.log('Successfully created white favicon.png');
  } catch (e) {
    console.error('Error processing logo:', e);
  }
}

main();
