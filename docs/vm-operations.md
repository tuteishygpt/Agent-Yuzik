# VM Operations

## Yuzik Warsaw VM

Use this command template for remote operations on the Yuzik VM:

```powershell
gcloud compute ssh svsvec@yuzik-warsaw-vm --project=macro-atom-477112-v3 --zone=europe-central2-b --command="<remote command>"
```

Interactive shell:

```powershell
gcloud compute ssh svsvec@yuzik-warsaw-vm --project=macro-atom-477112-v3 --zone=europe-central2-b
```

Before updating or restarting the VM, fill `--command` with the exact remote deploy or service command for the current host layout.
