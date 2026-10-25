# ربط Alhassan Hosting مع PocketMC

هذه الإضافة تضيف لوحة داخل صفحة **Servers** تعرض سيرفرات PocketMC الموجودة فعلاً وتسمح للمالك بتشغيلها وإيقافها وإعادة تشغيلها من خلال API آمن من جهة Netlify. لا يتم إرسال كلمة مرور PocketMC إلى المتصفح.

## حدود مهمة
- واجهة PocketMC API الموثقة تدعم عرض الـ instances والتحكم بها، لكنها لا توثّق حالياً endpoint لإنشاء instance جديد. لذلك زر إنشاء السيرفر في Alhassan Hosting ما زال ينشئ سجل إعدادات في Supabase فقط، ولا ينشئ instance داخل PocketMC تلقائياً.
- رابط Cloudflare Quick Tunnel يتغيّر أحياناً. إذا تغيّر، يجب تحديث `POCKETMC_BASE_URL` في Netlify.
- هذه الخطوة تربط لوحة التحكم بجهازك؛ لا تحوّل جهازك إلى استضافة سحابية مستقلة، ويجب أن يبقى الكمبيوتر وPocketMC شغالين.

## إعداد Netlify
افتح Site configuration → Environment variables وأضف المتغيرات التالية. استخدم **Settings → Remote Control** في PocketMC لإنشاء مستخدم فرعي خاص للربط، بصلاحيات محدودة للسيرفرات المطلوبة. لا تستخدم كلمة مرورك الأساسية إذا أمكن.

- `POCKETMC_BASE_URL`: رابط PocketMC العام الحالي فقط، مثل `https://example.trycloudflare.com`، بدون `/api` في النهاية.
- `POCKETMC_USERNAME`: اسم المستخدم الفرعي في PocketMC.
- `POCKETMC_PASSWORD`: كلمة مرور هذا المستخدم الفرعي.
- `POCKETMC_OWNER_USER_ID`: معرّف UUID لحساب المالك في Supabase Auth.
- `SUPABASE_URL`: رابط مشروع Supabase.
- `SUPABASE_ANON_KEY`: مفتاح Supabase anon/public الموجود أصلاً في إعدادات الموقع. لا تستخدم service-role key هنا.

بعد إضافة المتغيرات، أعد نشر الموقع (Redeploy). سجّل الدخول بحساب المالك، ثم افتح صفحة **Servers** واضغط **Connect / Refresh**.

## الأمان
- لا تضع كلمات مرور PocketMC أو أي مفاتيح سرية في متغيرات تبدأ بـ `VITE_`.
- لا ترسل كلمات المرور أو ملف `.env.local` لأي شخص، ولا ترفعه إلى GitHub.
- لا تفتح رابط PocketMC العام علناً ولا تستخدم حساب Admin الرئيسي للربط. استخدم مستخدماً فرعياً محدود الصلاحيات.
- الجسر يرفض أي حساب Supabase غير مطابق لـ `POCKETMC_OWNER_USER_ID`.
