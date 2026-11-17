    let penguPlayManifestUrl = null;

    if (keyRecord?.user_id) {
      const { data: penguData, error: penguError } =
        await req.supabase
          .from('provider_accounts')
          .select('encrypted_access_token')
          .eq('user_id', keyRecord.user_id)
          .eq('provider', 'penguplay')
          .maybeSingle();

      if (penguError) {
        console.error(
          '[RedDemon Cinema] Account lookup failed:',
          penguError
        );
      } else if (penguData?.encrypted_access_token) {
        try {
          penguPlayManifestUrl = decryptSecret(
            penguData.encrypted_access_token
          );
        } catch (decryptError) {
          console.error(
            '[RedDemon Cinema] Manifest decryption failed:',
            decryptError.message
          );
        }
      }
    }
