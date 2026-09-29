"""
Prueba la conexión SMTP de Gmail con los mismos datos que cargaste en Supabase
y muestra el motivo exacto si Google la rechaza. Envía un email de prueba a tu
propia dirección. La contraseña no se muestra ni se guarda.

Uso:  python probar_smtp.py
"""
import getpass
import smtplib
import ssl
from email.message import EmailMessage

HOST = "smtp.gmail.com"

email = input("Tu dirección de Gmail (la misma que pusiste en Supabase): ").strip()
password = getpass.getpass("Contraseña de aplicación (16 letras, no se ve al escribir): ").replace(" ", "")
print(f"\nLa contraseña tiene {len(password)} caracteres (debería tener 16).")

msg = EmailMessage()
msg["Subject"] = "Prueba SMTP de Focusly"
msg["From"] = f"Focusly <{email}>"
msg["To"] = email
msg.set_content("Si recibís este email, la configuración SMTP de Gmail funciona.")

def probar(puerto):
    print(f"\n--- Probando {HOST}:{puerto} ---")
    try:
        if puerto == 465:
            server = smtplib.SMTP_SSL(HOST, puerto, context=ssl.create_default_context(), timeout=20)
        else:
            server = smtplib.SMTP(HOST, puerto, timeout=20)
            server.starttls(context=ssl.create_default_context())
        with server:
            server.login(email, password)
            print("Login: OK")
            server.send_message(msg)
            print(f"Email de prueba enviado a {email}. ¡Esta configuración funciona!")
            return True
    except smtplib.SMTPAuthenticationError as e:
        print("Google rechazó el usuario/contraseña:")
        print("  ", e.smtp_code, e.smtp_error.decode(errors="ignore"))
    except Exception as e:
        print("Error:", type(e).__name__, e)
    return False

if not probar(465):
    probar(587)
input("\nPresioná Enter para cerrar...")
