import type { APIRoute } from 'astro';
import nodemailer from 'nodemailer';
import { config } from '../../config';

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    
    // Setup transporter using .env variables
    const transporter = nodemailer.createTransport({
      host: import.meta.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(import.meta.env.SMTP_PORT) || 587,
      secure: Number(import.meta.env.SMTP_PORT) === 465, // true for 465, false for other ports
      auth: {
        user: import.meta.env.SMTP_USER,
        pass: import.meta.env.SMTP_PASS,
      },
    });

    // Create the email content
    const htmlContent = `
      <div style="font-family: sans-serif; color: #333; max-w-xl">
        <h2 style="color: #4f46e5;">New 3D Print Quote Request</h2>
        <p><strong>Customer Name:</strong> ${data.name}</p>
        <p><strong>Customer Email:</strong> ${data.email}</p>
        
        <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 8px;">Print Specifications</h3>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Material:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${data.material}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Color:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${data.color}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Quality/Nozzle:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${data.quality}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Quantity:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${data.quantity}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;"><strong>Infill Density:</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #eee;">${data.infill}%</td>
          </tr>
        </table>
        
        <h3 style="border-bottom: 1px solid #ccc; padding-bottom: 8px;">Uploaded Files</h3>
        <ul style="margin-bottom: 24px;">
          ${data.files.map((f: any) => `<li>${f.name} (${f.volume} cm³)</li>`).join('')}
        </ul>
        
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; font-size: 18px;">
          <strong>Total Estimated Cost:</strong> 
          <span style="color: #4f46e5;">${import.meta.env.PUBLIC_CURRENCY_SYMBOL || '$'}${data.totalCost}</span>
        </div>
      </div>
    `;

    // Send email
    await transporter.sendMail({
      from: `"${config.brand.name} Estimator" <${import.meta.env.SMTP_USER}>`,
      to: config.brand.contactEmail,
      subject: `[New Quote] ${data.name} - ${import.meta.env.PUBLIC_CURRENCY_SYMBOL || '$'}${data.totalCost}`,
      replyTo: data.email,
      html: htmlContent,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Error sending email:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
