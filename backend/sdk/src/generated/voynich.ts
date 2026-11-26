/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/voynich.json`.
 */
export type Voynich = {
  "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS",
  "metadata": {
    "name": "voynich",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "attachWeights",
      "discriminator": [
        18,
        240,
        93,
        65,
        255,
        88,
        200,
        26
      ],
      "accounts": [
        {
          "name": "uploadKey",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "beginVersion",
      "discriminator": [
        89,
        118,
        83,
        105,
        17,
        209,
        98,
        112
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "modelVersion",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "arg",
                "path": "version"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "version",
          "type": "u32"
        },
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "beginVersionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "buyPass",
      "discriminator": [
        57,
        144,
        218,
        182,
        67,
        42,
        234,
        124
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "passPlan",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  45,
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "pass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "holderTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "passEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "callsTotal",
          "type": "u32"
        }
      ]
    },
    {
      "name": "claimReferral",
      "discriminator": [
        219,
        247,
        18,
        148,
        63,
        247,
        112,
        198
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "referral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "referral.model",
                "account": "referral"
              },
              {
                "kind": "account",
                "path": "referral.referrer",
                "account": "referral"
              }
            ]
          }
        },
        {
          "name": "referrer",
          "writable": true
        },
        {
          "name": "referralEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "referrerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "claimSplit",
      "discriminator": [
        129,
        43,
        213,
        192,
        109,
        118,
        139,
        38
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "split",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  108,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "split.model",
                "account": "split"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "splitEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "recipientTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "clearPolicy",
      "discriminator": [
        127,
        194,
        187,
        36,
        235,
        124,
        189,
        85
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "closePass",
      "discriminator": [
        165,
        74,
        197,
        223,
        61,
        96,
        167,
        201
      ],
      "accounts": [
        {
          "name": "closer",
          "writable": true,
          "signer": true
        },
        {
          "name": "pass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pass.model",
                "account": "pass"
              },
              {
                "kind": "account",
                "path": "pass.holder",
                "account": "pass"
              },
              {
                "kind": "account",
                "path": "pass.nonce",
                "account": "pass"
              }
            ]
          }
        },
        {
          "name": "holder",
          "writable": true
        },
        {
          "name": "passEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "holderTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "closeSession",
      "discriminator": [
        68,
        114,
        178,
        140,
        222,
        38,
        248,
        211
      ],
      "accounts": [
        {
          "name": "closer",
          "writable": true,
          "signer": true
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "session"
              },
              {
                "kind": "account",
                "path": "session.delegate",
                "account": "session"
              },
              {
                "kind": "account",
                "path": "session.nonce",
                "account": "session"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "sessionEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "createModel",
      "discriminator": [
        212,
        233,
        41,
        219,
        130,
        212,
        212,
        229
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "uploadKey",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "args.name"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "createModelArgs"
            }
          }
        }
      ]
    },
    {
      "name": "depositBond",
      "discriminator": [
        120,
        89,
        18,
        253,
        112,
        125,
        87,
        255
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "enclave"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "amountLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deprecateMeasurement",
      "discriminator": [
        168,
        198,
        99,
        230,
        225,
        216,
        225,
        88
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "measurement",
          "writable": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "grantByEnclave",
      "discriminator": [
        224,
        119,
        4,
        9,
        211,
        140,
        40,
        127
      ],
      "accounts": [
        {
          "name": "signingKey",
          "signer": true,
          "relations": [
            "sourceEnclave"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "sourceEnclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signingKey"
              }
            ]
          }
        },
        {
          "name": "sourceGrant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "sourceEnclave"
              }
            ]
          }
        },
        {
          "name": "sourceAttestationRecord"
        },
        {
          "name": "targetEnclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "targetAttestationRecord"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "targetEnclave"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "wrappedKey",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "grantByOwner",
      "discriminator": [
        201,
        72,
        8,
        221,
        34,
        178,
        68,
        207
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "targetEnclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "targetAttestationRecord"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "targetEnclave"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "wrappedKey",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "programAccount",
          "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS"
        },
        {
          "name": "programData"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "migrateConfig",
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "maxOpenAnswerBytes",
          "type": "u16"
        }
      ]
    },
    {
      "name": "migrateModel",
      "discriminator": [
        90,
        10,
        167,
        137,
        249,
        28,
        226,
        1
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "openCall",
      "discriminator": [
        153,
        26,
        89,
        45,
        252,
        243,
        183,
        62
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "openMeteredCall",
      "discriminator": [
        92,
        224,
        42,
        248,
        250,
        113,
        170,
        2
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        },
        {
          "name": "ceiling",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openPassCall",
      "discriminator": [
        53,
        169,
        0,
        89,
        95,
        60,
        142,
        188
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true,
          "relations": [
            "pass"
          ]
        },
        {
          "name": "pass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pass.model",
                "account": "pass"
              },
              {
                "kind": "account",
                "path": "pass.holder",
                "account": "pass"
              },
              {
                "kind": "account",
                "path": "pass.nonce",
                "account": "pass"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "passEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "openSession",
      "discriminator": [
        130,
        54,
        124,
        7,
        236,
        20,
        104,
        104
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "delegate",
          "writable": true
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "account",
                "path": "delegate"
              },
              {
                "kind": "arg",
                "path": "args.nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "sessionEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "openSessionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "openSessionCall",
      "discriminator": [
        217,
        163,
        222,
        192,
        23,
        143,
        252,
        62
      ],
      "accounts": [
        {
          "name": "delegate",
          "writable": true,
          "signer": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "session"
              },
              {
                "kind": "account",
                "path": "session.delegate",
                "account": "session"
              },
              {
                "kind": "account",
                "path": "session.nonce",
                "account": "session"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "session"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "sessionEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "openSessionMeteredCall",
      "discriminator": [
        16,
        109,
        144,
        136,
        134,
        165,
        40,
        12
      ],
      "accounts": [
        {
          "name": "delegate",
          "writable": true,
          "signer": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "session"
              },
              {
                "kind": "account",
                "path": "session.delegate",
                "account": "session"
              },
              {
                "kind": "account",
                "path": "session.nonce",
                "account": "session"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "session"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "sessionEscrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "inputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answerMode",
          "type": {
            "defined": {
              "name": "answerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "callbackSpec"
              }
            }
          }
        },
        {
          "name": "ceiling",
          "type": "u64"
        }
      ]
    },
    {
      "name": "publishBenchmark",
      "discriminator": [
        193,
        61,
        7,
        139,
        15,
        170,
        132,
        71
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "benchmark",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  110,
                  99,
                  104,
                  109,
                  97,
                  114,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "arg",
                "path": "args.name"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "publishBenchmarkArgs"
            }
          }
        }
      ]
    },
    {
      "name": "publishMeasurement",
      "discriminator": [
        86,
        47,
        29,
        38,
        13,
        226,
        134,
        1
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "measurement",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "digest",
          "type": {
            "array": [
              "u8",
              48
            ]
          }
        },
        {
          "name": "sourceRepo",
          "type": "string"
        },
        {
          "name": "commitSha",
          "type": "string"
        },
        {
          "name": "recipeHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "version",
          "type": "string"
        }
      ]
    },
    {
      "name": "publishVersion",
      "discriminator": [
        6,
        123,
        155,
        174,
        43,
        89,
        146,
        212
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "modelVersion"
          ]
        },
        {
          "name": "modelVersion",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "model_version.version",
                "account": "modelVersion"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "ciphertextSha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refreshEnclave",
      "discriminator": [
        186,
        43,
        26,
        36,
        222,
        112,
        250,
        10
      ],
      "accounts": [
        {
          "name": "signingKey",
          "signer": true,
          "relations": [
            "enclave"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signingKey"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "refundCall",
      "discriminator": [
        46,
        165,
        96,
        9,
        152,
        224,
        25,
        51
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "registerCallReferral",
      "discriminator": [
        174,
        215,
        251,
        222,
        255,
        143,
        16,
        70
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true,
          "relations": [
            "call"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "referralConfig",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "call",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "callReferral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108,
                  45,
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "referral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "arg",
                "path": "referrer"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "referrer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "registerEnclave",
      "discriminator": [
        212,
        174,
        251,
        235,
        52,
        145,
        141,
        168
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
        {
          "name": "signingKey",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signingKey"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "encryptionKey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "retireModel",
      "discriminator": [
        78,
        251,
        110,
        104,
        96,
        78,
        230,
        80
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "revokeGrant",
      "discriminator": [
        134,
        180,
        57,
        39,
        152,
        7,
        154,
        98
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "grant",
          "writable": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "sealModel",
      "discriminator": [
        130,
        170,
        138,
        45,
        104,
        73,
        50,
        8
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "ciphertextSha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "sealRange",
      "discriminator": [
        236,
        184,
        234,
        164,
        68,
        233,
        228,
        52
      ],
      "accounts": [
        {
          "name": "uploadKey",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "chunkCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "sealVersionRange",
      "discriminator": [
        59,
        150,
        208,
        207,
        173,
        66,
        216,
        223
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "modelVersion"
          ]
        },
        {
          "name": "modelVersion",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "model_version.version",
                "account": "modelVersion"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "chunkCount",
          "type": "u32"
        }
      ]
    },
    {
      "name": "setAllowedMeasurements",
      "discriminator": [
        25,
        78,
        234,
        157,
        110,
        103,
        244,
        59
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "allowedMeasurements",
          "type": {
            "vec": {
              "array": [
                "u8",
                48
              ]
            }
          }
        }
      ]
    },
    {
      "name": "setConfig",
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "configArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setPassPlan",
      "discriminator": [
        129,
        65,
        100,
        143,
        23,
        201,
        26,
        184
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "passPlan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  45,
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "setPassPlanArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setPolicy",
      "discriminator": [
        40,
        133,
        12,
        157,
        235,
        202,
        2,
        132
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "policyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "setPrice",
      "discriminator": [
        16,
        19,
        182,
        8,
        149,
        83,
        72,
        181
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "priceMint",
          "type": "pubkey"
        },
        {
          "name": "operatorShareBps",
          "type": "u16"
        },
        {
          "name": "priceUnit",
          "type": {
            "defined": {
              "name": "priceUnit"
            }
          }
        }
      ]
    },
    {
      "name": "setQuote",
      "discriminator": [
        59,
        95,
        185,
        175,
        67,
        228,
        200,
        29
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "enclave"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          }
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "operatorShareBps",
          "type": {
            "option": "u16"
          }
        }
      ]
    },
    {
      "name": "setReferralConfig",
      "discriminator": [
        114,
        36,
        32,
        209,
        207,
        21,
        21,
        247
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "referralConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "shareBps",
          "type": "u16"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setSplit",
      "discriminator": [
        133,
        67,
        66,
        245,
        114,
        175,
        32,
        51
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "split",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  108,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "recipients",
          "type": {
            "vec": {
              "defined": {
                "name": "splitRecipientInput"
              }
            }
          }
        }
      ]
    },
    {
      "name": "settleCall",
      "discriminator": [
        58,
        230,
        6,
        58,
        104,
        245,
        154,
        227
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "ownerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operatorTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocolTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "outputHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "ed25519InstructionIndex",
          "type": "u16"
        },
        {
          "name": "openAnswer",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "settleMeteredCall",
      "discriminator": [
        135,
        233,
        76,
        116,
        130,
        184,
        85,
        190
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestationRecord"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "feeRecipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrowTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "ownerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operatorTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocolTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "callerTokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "tokenProgram",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "count",
          "type": "u64"
        },
        {
          "name": "runningHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "ed25519InstructionIndex",
          "type": "u16"
        }
      ]
    },
    {
      "name": "withdrawBond",
      "discriminator": [
        222,
        199,
        141,
        31,
        188,
        93,
        155,
        40
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "enclave",
            "bond"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "enclave"
              }
            ]
          },
          "relations": [
            "bond"
          ]
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "amountLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "writeVersionWeights",
      "discriminator": [
        214,
        49,
        206,
        175,
        70,
        25,
        202,
        9
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          },
          "relations": [
            "modelVersion"
          ]
        },
        {
          "name": "modelVersion",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "model_version.version",
                "account": "modelVersion"
              }
            ]
          }
        },
        {
          "name": "weights",
          "writable": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "writeWeights",
      "discriminator": [
        17,
        26,
        177,
        52,
        60,
        99,
        254,
        61
      ],
      "accounts": [
        {
          "name": "uploadKey",
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "model"
              }
            ]
          }
        },
        {
          "name": "weights",
          "writable": true
        },
        {
          "name": "eventAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "benchmark",
      "discriminator": [
        57,
        252,
        33,
        54,
        113,
        141,
        233,
        247
      ]
    },
    {
      "name": "bond",
      "discriminator": [
        224,
        128,
        48,
        251,
        182,
        246,
        111,
        196
      ]
    },
    {
      "name": "call",
      "discriminator": [
        62,
        231,
        169,
        58,
        154,
        150,
        83,
        196
      ]
    },
    {
      "name": "callReferral",
      "discriminator": [
        164,
        188,
        11,
        242,
        52,
        117,
        5,
        186
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "enclave",
      "discriminator": [
        222,
        166,
        223,
        252,
        18,
        3,
        84,
        34
      ]
    },
    {
      "name": "grant",
      "discriminator": [
        161,
        166,
        11,
        205,
        204,
        135,
        205,
        54
      ]
    },
    {
      "name": "measurement",
      "discriminator": [
        102,
        58,
        48,
        155,
        68,
        220,
        172,
        169
      ]
    },
    {
      "name": "model",
      "discriminator": [
        152,
        221,
        247,
        122,
        185,
        125,
        223,
        151
      ]
    },
    {
      "name": "modelVersion",
      "discriminator": [
        22,
        236,
        9,
        80,
        24,
        101,
        127,
        43
      ]
    },
    {
      "name": "pass",
      "discriminator": [
        40,
        247,
        140,
        113,
        56,
        14,
        57,
        44
      ]
    },
    {
      "name": "passPlan",
      "discriminator": [
        194,
        153,
        247,
        119,
        210,
        16,
        50,
        143
      ]
    },
    {
      "name": "policy",
      "discriminator": [
        222,
        135,
        7,
        163,
        235,
        177,
        33,
        68
      ]
    },
    {
      "name": "receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    },
    {
      "name": "referral",
      "discriminator": [
        30,
        235,
        136,
        224,
        106,
        107,
        49,
        64
      ]
    },
    {
      "name": "referralConfig",
      "discriminator": [
        102,
        148,
        171,
        235,
        148,
        83,
        250,
        140
      ]
    },
    {
      "name": "session",
      "discriminator": [
        243,
        81,
        72,
        115,
        214,
        188,
        72,
        144
      ]
    },
    {
      "name": "split",
      "discriminator": [
        166,
        254,
        141,
        46,
        23,
        221,
        129,
        195
      ]
    }
  ],
  "events": [
    {
      "name": "benchmarkPublished",
      "discriminator": [
        194,
        226,
        244,
        246,
        119,
        165,
        196,
        39
      ]
    },
    {
      "name": "bondDeposited",
      "discriminator": [
        210,
        149,
        47,
        232,
        72,
        128,
        248,
        153
      ]
    },
    {
      "name": "bondSlashed",
      "discriminator": [
        59,
        7,
        252,
        195,
        234,
        156,
        42,
        54
      ]
    },
    {
      "name": "bondWithdrawn",
      "discriminator": [
        111,
        192,
        154,
        231,
        58,
        115,
        130,
        103
      ]
    },
    {
      "name": "callOpened",
      "discriminator": [
        80,
        97,
        83,
        218,
        46,
        113,
        128,
        51
      ]
    },
    {
      "name": "callReferralRegistered",
      "discriminator": [
        64,
        224,
        227,
        153,
        217,
        1,
        225,
        217
      ]
    },
    {
      "name": "callRefunded",
      "discriminator": [
        251,
        135,
        14,
        71,
        98,
        14,
        36,
        55
      ]
    },
    {
      "name": "callSettled",
      "discriminator": [
        240,
        201,
        54,
        197,
        132,
        33,
        150,
        213
      ]
    },
    {
      "name": "configChanged",
      "discriminator": [
        147,
        25,
        86,
        98,
        98,
        77,
        78,
        192
      ]
    },
    {
      "name": "enclaveChanged",
      "discriminator": [
        172,
        222,
        157,
        110,
        37,
        32,
        242,
        36
      ]
    },
    {
      "name": "grantChanged",
      "discriminator": [
        249,
        62,
        42,
        174,
        52,
        50,
        226,
        161
      ]
    },
    {
      "name": "grantQuoteUpdated",
      "discriminator": [
        146,
        166,
        47,
        92,
        137,
        176,
        27,
        246
      ]
    },
    {
      "name": "measurementDeprecated",
      "discriminator": [
        37,
        236,
        155,
        91,
        134,
        208,
        208,
        201
      ]
    },
    {
      "name": "measurementPublished",
      "discriminator": [
        172,
        102,
        54,
        149,
        1,
        131,
        76,
        35
      ]
    },
    {
      "name": "modelAllowedMeasurementsChanged",
      "discriminator": [
        126,
        158,
        15,
        156,
        53,
        232,
        232,
        69
      ]
    },
    {
      "name": "modelCreated",
      "discriminator": [
        233,
        244,
        157,
        153,
        211,
        252,
        76,
        24
      ]
    },
    {
      "name": "modelPriceChanged",
      "discriminator": [
        117,
        35,
        157,
        109,
        59,
        62,
        35,
        35
      ]
    },
    {
      "name": "modelSealed",
      "discriminator": [
        15,
        215,
        238,
        15,
        184,
        75,
        183,
        235
      ]
    },
    {
      "name": "modelStatusChanged",
      "discriminator": [
        234,
        246,
        98,
        82,
        90,
        240,
        19,
        53
      ]
    },
    {
      "name": "modelVersionPublished",
      "discriminator": [
        193,
        96,
        36,
        8,
        41,
        6,
        208,
        196
      ]
    },
    {
      "name": "modelVersionStarted",
      "discriminator": [
        79,
        78,
        143,
        45,
        232,
        156,
        200,
        196
      ]
    },
    {
      "name": "passClosed",
      "discriminator": [
        122,
        76,
        69,
        52,
        68,
        10,
        33,
        223
      ]
    },
    {
      "name": "passPlanUpdated",
      "discriminator": [
        166,
        227,
        117,
        122,
        135,
        88,
        80,
        115
      ]
    },
    {
      "name": "passPurchased",
      "discriminator": [
        11,
        171,
        162,
        118,
        129,
        168,
        151,
        90
      ]
    },
    {
      "name": "passUsed",
      "discriminator": [
        131,
        42,
        120,
        140,
        122,
        112,
        205,
        177
      ]
    },
    {
      "name": "policyCleared",
      "discriminator": [
        113,
        209,
        132,
        14,
        255,
        192,
        12,
        11
      ]
    },
    {
      "name": "policyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "rangeSealed",
      "discriminator": [
        134,
        176,
        3,
        229,
        181,
        140,
        220,
        27
      ]
    },
    {
      "name": "referralClaimed",
      "discriminator": [
        195,
        109,
        77,
        196,
        134,
        226,
        78,
        108
      ]
    },
    {
      "name": "referralConfigUpdated",
      "discriminator": [
        97,
        103,
        139,
        190,
        11,
        212,
        97,
        58
      ]
    },
    {
      "name": "referralCredited",
      "discriminator": [
        168,
        129,
        33,
        226,
        83,
        56,
        219,
        73
      ]
    },
    {
      "name": "sessionClosed",
      "discriminator": [
        57,
        237,
        11,
        243,
        194,
        34,
        120,
        27
      ]
    },
    {
      "name": "sessionDebited",
      "discriminator": [
        136,
        108,
        160,
        44,
        177,
        125,
        36,
        109
      ]
    },
    {
      "name": "sessionOpened",
      "discriminator": [
        34,
        79,
        77,
        95,
        195,
        207,
        104,
        223
      ]
    },
    {
      "name": "splitClaimed",
      "discriminator": [
        234,
        11,
        44,
        178,
        141,
        137,
        23,
        193
      ]
    },
    {
      "name": "splitCredited",
      "discriminator": [
        215,
        244,
        242,
        85,
        233,
        26,
        109,
        122
      ]
    },
    {
      "name": "splitUpdated",
      "discriminator": [
        110,
        85,
        143,
        135,
        98,
        156,
        185,
        91
      ]
    },
    {
      "name": "weightsAttached",
      "discriminator": [
        225,
        95,
        252,
        229,
        1,
        207,
        233,
        95
      ]
    },
    {
      "name": "weightsWritten",
      "discriminator": [
        231,
        48,
        23,
        136,
        234,
        185,
        86,
        45
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the configured authority may perform this action."
    },
    {
      "code": 6001,
      "name": "invalidConfig",
      "msg": "Protocol configuration is invalid."
    },
    {
      "code": 6002,
      "name": "invalidModel",
      "msg": "Model metadata or cipher format is invalid."
    },
    {
      "code": 6003,
      "name": "modelNotUploading",
      "msg": "The model is not uploading."
    },
    {
      "code": 6004,
      "name": "modelNotSealed",
      "msg": "Seal the model before granting it."
    },
    {
      "code": 6005,
      "name": "modelNotLive",
      "msg": "The model does not accept new calls."
    },
    {
      "code": 6006,
      "name": "invalidWeights",
      "msg": "The weights accounts do not match the model."
    },
    {
      "code": 6007,
      "name": "invalidWrite",
      "msg": "The upload has a gap or an out-of-range write."
    },
    {
      "code": 6008,
      "name": "uploadIncomplete",
      "msg": "Every weights byte must be written before sealing."
    },
    {
      "code": 6009,
      "name": "ciphertextHashMismatch",
      "msg": "The ciphertext hash does not match."
    },
    {
      "code": 6010,
      "name": "invalidAttestation",
      "msg": "The attestation record is invalid or expired."
    },
    {
      "code": 6011,
      "name": "measurementNotAllowed",
      "msg": "The enclave measurement is not allowed by this model."
    },
    {
      "code": 6012,
      "name": "invalidEnclave",
      "msg": "The enclave registration does not match its attestation."
    },
    {
      "code": 6013,
      "name": "invalidWrappedKey",
      "msg": "The wrapped key must be a version 1 envelope of 105 bytes."
    },
    {
      "code": 6014,
      "name": "grantRequired",
      "msg": "The enclave does not hold an active grant."
    },
    {
      "code": 6015,
      "name": "callNotOpen",
      "msg": "The call has already settled or been refunded."
    },
    {
      "code": 6016,
      "name": "callDeadlinePassed",
      "msg": "The call settlement deadline has passed."
    },
    {
      "code": 6017,
      "name": "callNotRefundable",
      "msg": "The call deadline has not passed."
    },
    {
      "code": 6018,
      "name": "invalidSignature",
      "msg": "The required Ed25519 verification instruction is missing or does not match."
    },
    {
      "code": 6019,
      "name": "invalidTokenAccount",
      "msg": "The escrow mint or token accounts are invalid."
    },
    {
      "code": 6020,
      "name": "invalidRecipient",
      "msg": "A payment recipient does not match the call snapshot."
    },
    {
      "code": 6021,
      "name": "insufficientEscrow",
      "msg": "The escrow cannot cover the requested payment."
    },
    {
      "code": 6022,
      "name": "arithmeticOverflow",
      "msg": "An arithmetic limit was exceeded."
    },
    {
      "code": 6023,
      "name": "invalidOpenAnswer",
      "msg": "The open answer bytes are empty, exceed the configured limit, or do not match the output hash."
    },
    {
      "code": 6024,
      "name": "invalidCallback",
      "msg": "The callback specification or remaining accounts are invalid."
    },
    {
      "code": 6025,
      "name": "invalidCall",
      "msg": "The call pricing unit or escrow ceiling is invalid for this instruction."
    },
    {
      "code": 6026,
      "name": "invalidMeasurement",
      "msg": "The measurement digest, source metadata, or status is invalid."
    },
    {
      "code": 6027,
      "name": "invalidPolicy",
      "msg": "The model policy limits, callers, operators, or regions are invalid."
    },
    {
      "code": 6028,
      "name": "policyCallerDenied",
      "msg": "The caller is not on this model's allow list."
    },
    {
      "code": 6029,
      "name": "policyOperatorDenied",
      "msg": "The enclave operator is not allowed by this model's policy."
    },
    {
      "code": 6030,
      "name": "policyRequired",
      "msg": "This model has an active policy; pass its Policy account in remaining accounts."
    },
    {
      "code": 6031,
      "name": "invalidQuote",
      "msg": "The quoted operator share exceeds the model's maximum operator share."
    },
    {
      "code": 6032,
      "name": "invalidVersion",
      "msg": "The model version is invalid or not in the required state."
    },
    {
      "code": 6033,
      "name": "invalidSession",
      "msg": "The caller session is closed, expired, out of budget, or does not match this call."
    },
    {
      "code": 6034,
      "name": "invalidSplit",
      "msg": "The revenue split configuration, remaining account, or claim is invalid."
    },
    {
      "code": 6035,
      "name": "invalidBond",
      "msg": "The operator bond deposit, withdrawal, or remaining account is invalid."
    },
    {
      "code": 6036,
      "name": "invalidBenchmark",
      "msg": "The benchmark name, dataset, score, or receipt proofs are invalid."
    },
    {
      "code": 6037,
      "name": "invalidPass",
      "msg": "The pass plan or prepaid pass is invalid, inactive, expired, or exhausted."
    },
    {
      "code": 6038,
      "name": "invalidReferral",
      "msg": "The referral config, call referral, or referral claim is invalid."
    }
  ],
  "types": [
    {
      "name": "answerMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sealed"
          },
          {
            "name": "open"
          }
        ]
      }
    },
    {
      "name": "beginVersionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "benchmark",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "modelVersion",
            "type": "u32"
          },
          {
            "name": "datasetSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "datasetUri",
            "type": "string"
          },
          {
            "name": "sampleCount",
            "type": "u32"
          },
          {
            "name": "passedCount",
            "type": "u32"
          },
          {
            "name": "scoreBps",
            "type": "u16"
          },
          {
            "name": "receipts",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "publishedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "benchmarkPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "benchmark",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "modelVersion",
            "type": "u32"
          },
          {
            "name": "datasetSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "datasetUri",
            "type": "string"
          },
          {
            "name": "sampleCount",
            "type": "u32"
          },
          {
            "name": "passedCount",
            "type": "u32"
          },
          {
            "name": "scoreBps",
            "type": "u16"
          },
          {
            "name": "receipts",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "publishedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bond",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "bondedLamports",
            "type": "u64"
          },
          {
            "name": "slashedTotal",
            "type": "u64"
          },
          {
            "name": "missedCalls",
            "type": "u64"
          },
          {
            "name": "slashBps",
            "type": "u16"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bondDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bondedLamports",
            "type": "u64"
          },
          {
            "name": "slashBps",
            "type": "u16"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bondSlashed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bondedLamports",
            "type": "u64"
          },
          {
            "name": "slashedTotal",
            "type": "u64"
          },
          {
            "name": "missedCalls",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "bondWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bondedLamports",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "call",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "openedSlot",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "callStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          },
          {
            "name": "callbackProgram",
            "type": "pubkey"
          },
          {
            "name": "callbackAccounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "callbackAccount"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "callOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "openedSlot",
            "type": "u64"
          },
          {
            "name": "deadlineSlot",
            "type": "u64"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          },
          {
            "name": "callbackProgram",
            "type": "pubkey"
          },
          {
            "name": "callbackAccounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "callbackAccount"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "callReferral",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "callReferralRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "callReferral",
            "type": "pubkey"
          },
          {
            "name": "referral",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "callRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "callStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "callSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "signature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "ownerAmount",
            "type": "u64"
          },
          {
            "name": "operatorAmount",
            "type": "u64"
          },
          {
            "name": "protocolAmount",
            "type": "u64"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "openAnswer",
            "type": "bytes"
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          },
          {
            "name": "deliveredCount",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "returnedAmount",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "callStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "settled"
          },
          {
            "name": "refunded"
          }
        ]
      }
    },
    {
      "name": "callbackAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": "pubkey"
          },
          {
            "name": "isWritable",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "callbackSpec",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "program",
            "type": "pubkey"
          },
          {
            "name": "accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "callbackAccount"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "attestationProgram",
            "type": "pubkey"
          },
          {
            "name": "recordLayoutVersion",
            "type": "u8"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "callDeadlineSlots",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "maxOpenAnswerBytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "configArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "attestationProgram",
            "type": "pubkey"
          },
          {
            "name": "recordLayoutVersion",
            "type": "u8"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "protocolShareBps",
            "type": "u16"
          },
          {
            "name": "callDeadlineSlots",
            "type": "u64"
          },
          {
            "name": "maxOpenAnswerBytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "configChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "configArgs"
              }
            }
          }
        ]
      }
    },
    {
      "name": "createModelArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "uploadFundingLamports",
            "type": "u64"
          },
          {
            "name": "extraUploadKeyCount",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "enclave",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signingKey",
            "type": "pubkey"
          },
          {
            "name": "encryptionKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "attestationRecord",
            "type": "pubkey"
          },
          {
            "name": "hardwareType",
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recordedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "callsSettled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "enclaveChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "signingKey",
            "type": "pubkey"
          },
          {
            "name": "encryptionKey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "record",
            "type": "pubkey"
          },
          {
            "name": "hardwareType",
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recordedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "grant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrappedKey",
            "type": "bytes"
          },
          {
            "name": "grantedBy",
            "type": "pubkey"
          },
          {
            "name": "grantedSlot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "quotedOperatorShareBps",
            "type": {
              "option": "u16"
            }
          }
        ]
      }
    },
    {
      "name": "grantChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "grant",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrappedKey",
            "type": "bytes"
          },
          {
            "name": "grantedBy",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "grantQuoteUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "quotedOperatorShareBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "measurement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "sourceRepo",
            "type": "string"
          },
          {
            "name": "commitSha",
            "type": "string"
          },
          {
            "name": "recipeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "measurementStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "measurementDeprecated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "measurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "measurementPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "sourceRepo",
            "type": "string"
          },
          {
            "name": "commitSha",
            "type": "string"
          },
          {
            "name": "recipeHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "measurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "measurementStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "deprecated"
          }
        ]
      }
    },
    {
      "name": "model",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "docs": [
              "Pubkey::default() denotes native SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "uploadKey",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "modelStatus"
              }
            }
          },
          {
            "name": "createdSlot",
            "type": "u64"
          },
          {
            "name": "sealedSlot",
            "type": "u64"
          },
          {
            "name": "callsSettled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "uploadKeys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hashVersion",
            "type": "u8"
          },
          {
            "name": "sealedChunks",
            "type": "u32"
          },
          {
            "name": "merkleFrontier",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "merkleFrontierMask",
            "type": "u32"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          },
          {
            "name": "hasPolicy",
            "type": "bool"
          },
          {
            "name": "currentVersion",
            "type": "u32"
          },
          {
            "name": "hasSplit",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "modelAllowedMeasurementsChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelBase",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "format",
            "type": "string"
          },
          {
            "name": "source",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "modelCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowedMeasurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "uploadKey",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "uploadKeys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hashVersion",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelPriceChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "operatorShareBps",
            "type": "u16"
          },
          {
            "name": "priceUnit",
            "type": {
              "defined": {
                "name": "priceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "ciphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "baseSha256",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "uploading"
          },
          {
            "name": "sealed"
          },
          {
            "name": "live"
          },
          {
            "name": "retired"
          }
        ]
      }
    },
    {
      "name": "modelStatusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "modelStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "modelVersion",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "versionStatus"
              }
            }
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "hashVersion",
            "type": "u8"
          },
          {
            "name": "sealedChunks",
            "type": "u32"
          },
          {
            "name": "merkleFrontier",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "merkleFrontierMask",
            "type": "u32"
          },
          {
            "name": "publishedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "modelVersionPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "modelVersion",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "previousVersion",
            "type": "u32"
          },
          {
            "name": "previousCiphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "previousSizeBytes",
            "type": "u64"
          },
          {
            "name": "previousSealedSlot",
            "type": "u64"
          },
          {
            "name": "previousBase",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertextSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "publishedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "modelVersionStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "modelVersion",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "sizeBytes",
            "type": "u64"
          },
          {
            "name": "noncePrefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "modelBase"
                }
              }
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "openSessionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "delegateGasLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pass",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pricePerCall",
            "type": "u64"
          },
          {
            "name": "callsTotal",
            "type": "u32"
          },
          {
            "name": "callsUsed",
            "type": "u32"
          },
          {
            "name": "escrowRemaining",
            "type": "u64"
          },
          {
            "name": "purchasedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "passStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "passClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "closer",
            "type": "pubkey"
          },
          {
            "name": "returnedAmount",
            "type": "u64"
          },
          {
            "name": "callsUsed",
            "type": "u32"
          },
          {
            "name": "callsTotal",
            "type": "u32"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "passStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "passPlan",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pricePerCall",
            "type": "u64"
          },
          {
            "name": "minCalls",
            "type": "u32"
          },
          {
            "name": "maxCalls",
            "type": "u32"
          },
          {
            "name": "ttlSlots",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "passPlanUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "passPlan",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pricePerCall",
            "type": "u64"
          },
          {
            "name": "minCalls",
            "type": "u32"
          },
          {
            "name": "maxCalls",
            "type": "u32"
          },
          {
            "name": "ttlSlots",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "passPurchased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "pricePerCall",
            "type": "u64"
          },
          {
            "name": "callsTotal",
            "type": "u32"
          },
          {
            "name": "escrowRemaining",
            "type": "u64"
          },
          {
            "name": "purchasedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "passStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "passUsed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "callsUsed",
            "type": "u32"
          },
          {
            "name": "callsTotal",
            "type": "u32"
          },
          {
            "name": "escrowRemaining",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "policy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allowListEnabled",
            "type": "bool"
          },
          {
            "name": "allowedCallers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "maxCallsPerCallerPerWindow",
            "type": "u32"
          },
          {
            "name": "windowSlots",
            "type": "u64"
          },
          {
            "name": "allowedOperators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowedRegions",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "policyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "allowListEnabled",
            "type": "bool"
          },
          {
            "name": "allowedCallers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "maxCallsPerCallerPerWindow",
            "type": "u32"
          },
          {
            "name": "windowSlots",
            "type": "u64"
          },
          {
            "name": "allowedOperators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowedRegions",
            "type": {
              "vec": "string"
            }
          }
        ]
      }
    },
    {
      "name": "policyCleared",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "policyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allowListEnabled",
            "type": "bool"
          },
          {
            "name": "allowedCallers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "maxCallsPerCallerPerWindow",
            "type": "u32"
          },
          {
            "name": "windowSlots",
            "type": "u64"
          },
          {
            "name": "allowedOperators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowedRegions",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUnit",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "call"
          },
          {
            "name": "token"
          }
        ]
      }
    },
    {
      "name": "publishBenchmarkArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "datasetSha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "datasetUri",
            "type": "string"
          },
          {
            "name": "sampleCount",
            "type": "u32"
          },
          {
            "name": "passedCount",
            "type": "u32"
          },
          {
            "name": "scoreBps",
            "type": "u16"
          },
          {
            "name": "receipts",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "rangeSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "startChunk",
            "type": "u32"
          },
          {
            "name": "chunkCount",
            "type": "u32"
          },
          {
            "name": "sealedChunks",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "receipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "inputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "outputHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "signature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "priceMint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "feeRecipient",
            "type": "pubkey"
          },
          {
            "name": "ownerAmount",
            "type": "u64"
          },
          {
            "name": "operatorAmount",
            "type": "u64"
          },
          {
            "name": "protocolAmount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answerMode",
            "type": {
              "defined": {
                "name": "answerMode"
              }
            }
          },
          {
            "name": "openAnswer",
            "type": "bytes"
          },
          {
            "name": "callerIsProgram",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "referral",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "totalEarned",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "callsReferred",
            "type": "u64"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "referralClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referral",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "referralConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "referralConfigUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referralConfig",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "referralCredited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referral",
            "type": "pubkey"
          },
          {
            "name": "callReferral",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalEarned",
            "type": "u64"
          },
          {
            "name": "callsReferred",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "session",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "callsOpened",
            "type": "u64"
          },
          {
            "name": "openedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "sessionStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "sessionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "closer",
            "type": "pubkey"
          },
          {
            "name": "returnedAmount",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "callsOpened",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "sessionStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "sessionDebited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "callsOpened",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sessionOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "openedSlot",
            "type": "u64"
          },
          {
            "name": "expiresAtSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sessionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "setPassPlanArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pricePerCall",
            "type": "u64"
          },
          {
            "name": "minCalls",
            "type": "u32"
          },
          {
            "name": "maxCalls",
            "type": "u32"
          },
          {
            "name": "ttlSlots",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "split",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "totalReceived",
            "type": "u64"
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "splitRecipient"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "splitClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "split",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalClaimed",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "splitCredited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "split",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "totalReceived",
            "type": "u64"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "splitRecipient"
                }
              }
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "splitRecipient",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          },
          {
            "name": "accrued",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "splitRecipientInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "shareBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "splitUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "split",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "splitRecipient"
                }
              }
            }
          },
          {
            "name": "updatedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "versionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "uploading"
          },
          {
            "name": "live"
          },
          {
            "name": "archived"
          }
        ]
      }
    },
    {
      "name": "weightsAttached",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "weightsWritten",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": "pubkey"
          },
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "length",
            "type": "u32"
          },
          {
            "name": "writtenBytes",
            "type": "u32"
          }
        ]
      }
    }
  ]
};

// Generated by npm run build:programs. Anchor converts the runtime IDL names to camelCase.
export const IDL: Voynich = {
  "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS",
  "metadata": {
    "name": "voynich",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "attach_weights",
      "discriminator": [
        18,
        240,
        93,
        65,
        255,
        88,
        200,
        26
      ],
      "accounts": [
        {
          "name": "upload_key",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "begin_version",
      "discriminator": [
        89,
        118,
        83,
        105,
        17,
        209,
        98,
        112
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "model_version",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "arg",
                "path": "version"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "version",
          "type": "u32"
        },
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "BeginVersionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "buy_pass",
      "discriminator": [
        57,
        144,
        218,
        182,
        67,
        42,
        234,
        124
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "pass_plan",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  45,
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "pass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "holder_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "pass_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "calls_total",
          "type": "u32"
        }
      ]
    },
    {
      "name": "claim_referral",
      "discriminator": [
        219,
        247,
        18,
        148,
        63,
        247,
        112,
        198
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "referral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "referral.model",
                "account": "Referral"
              },
              {
                "kind": "account",
                "path": "referral.referrer",
                "account": "Referral"
              }
            ]
          }
        },
        {
          "name": "referrer",
          "writable": true
        },
        {
          "name": "referral_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "referrer_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "claim_split",
      "discriminator": [
        129,
        43,
        213,
        192,
        109,
        118,
        139,
        38
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "split",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  108,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "split.model",
                "account": "Split"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "split_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "recipient_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "clear_policy",
      "discriminator": [
        127,
        194,
        187,
        36,
        235,
        124,
        189,
        85
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "close_pass",
      "discriminator": [
        165,
        74,
        197,
        223,
        61,
        96,
        167,
        201
      ],
      "accounts": [
        {
          "name": "closer",
          "writable": true,
          "signer": true
        },
        {
          "name": "pass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pass.model",
                "account": "Pass"
              },
              {
                "kind": "account",
                "path": "pass.holder",
                "account": "Pass"
              },
              {
                "kind": "account",
                "path": "pass.nonce",
                "account": "Pass"
              }
            ]
          }
        },
        {
          "name": "holder",
          "writable": true
        },
        {
          "name": "pass_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "holder_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "close_session",
      "discriminator": [
        68,
        114,
        178,
        140,
        222,
        38,
        248,
        211
      ],
      "accounts": [
        {
          "name": "closer",
          "writable": true,
          "signer": true
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "Session"
              },
              {
                "kind": "account",
                "path": "session.delegate",
                "account": "Session"
              },
              {
                "kind": "account",
                "path": "session.nonce",
                "account": "Session"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "session_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "create_model",
      "discriminator": [
        212,
        233,
        41,
        219,
        130,
        212,
        212,
        229
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "upload_key",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "args.name"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "CreateModelArgs"
            }
          }
        }
      ]
    },
    {
      "name": "deposit_bond",
      "discriminator": [
        120,
        89,
        18,
        253,
        112,
        125,
        87,
        255
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "enclave"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "amount_lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deprecate_measurement",
      "discriminator": [
        168,
        198,
        99,
        230,
        225,
        216,
        225,
        88
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "measurement",
          "writable": true
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "grant_by_enclave",
      "discriminator": [
        224,
        119,
        4,
        9,
        211,
        140,
        40,
        127
      ],
      "accounts": [
        {
          "name": "signing_key",
          "signer": true,
          "relations": [
            "source_enclave"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "source_enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signing_key"
              }
            ]
          }
        },
        {
          "name": "source_grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "source_enclave"
              }
            ]
          }
        },
        {
          "name": "source_attestation_record"
        },
        {
          "name": "target_enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "target_attestation_record"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "target_enclave"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "wrapped_key",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "grant_by_owner",
      "discriminator": [
        201,
        72,
        8,
        221,
        34,
        178,
        68,
        207
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "target_enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "target_enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "target_attestation_record"
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "target_enclave"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "wrapped_key",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "program_account",
          "address": "65H3C7T6C2DmbkR9ssBBmNtqpybWcYwotkkETL4E7RSS"
        },
        {
          "name": "program_data"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "ConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "migrate_config",
      "discriminator": [
        92,
        131,
        58,
        105,
        210,
        154,
        224,
        193
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "max_open_answer_bytes",
          "type": "u16"
        }
      ]
    },
    {
      "name": "migrate_model",
      "discriminator": [
        90,
        10,
        167,
        137,
        249,
        28,
        226,
        1
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "open_call",
      "discriminator": [
        153,
        26,
        89,
        45,
        252,
        243,
        183,
        62
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "open_metered_call",
      "discriminator": [
        92,
        224,
        42,
        248,
        250,
        113,
        170,
        2
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        },
        {
          "name": "ceiling",
          "type": "u64"
        }
      ]
    },
    {
      "name": "open_pass_call",
      "discriminator": [
        53,
        169,
        0,
        89,
        95,
        60,
        142,
        188
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true,
          "relations": [
            "pass"
          ]
        },
        {
          "name": "pass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115
                ]
              },
              {
                "kind": "account",
                "path": "pass.model",
                "account": "Pass"
              },
              {
                "kind": "account",
                "path": "pass.holder",
                "account": "Pass"
              },
              {
                "kind": "account",
                "path": "pass.nonce",
                "account": "Pass"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "pass_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "open_session",
      "discriminator": [
        130,
        54,
        124,
        7,
        236,
        20,
        104,
        104
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true
        },
        {
          "name": "delegate",
          "writable": true
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "caller"
              },
              {
                "kind": "account",
                "path": "delegate"
              },
              {
                "kind": "arg",
                "path": "args.nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "session_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "OpenSessionArgs"
            }
          }
        }
      ]
    },
    {
      "name": "open_session_call",
      "discriminator": [
        217,
        163,
        222,
        192,
        23,
        143,
        252,
        62
      ],
      "accounts": [
        {
          "name": "delegate",
          "writable": true,
          "signer": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "Session"
              },
              {
                "kind": "account",
                "path": "session.delegate",
                "account": "Session"
              },
              {
                "kind": "account",
                "path": "session.nonce",
                "account": "Session"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "Session"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "session_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "open_session_metered_call",
      "discriminator": [
        16,
        109,
        144,
        136,
        134,
        165,
        40,
        12
      ],
      "accounts": [
        {
          "name": "delegate",
          "writable": true,
          "signer": true,
          "relations": [
            "session"
          ]
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "Session"
              },
              {
                "kind": "account",
                "path": "session.delegate",
                "account": "Session"
              },
              {
                "kind": "account",
                "path": "session.nonce",
                "account": "Session"
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "grant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "session.caller",
                "account": "Session"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "mint",
          "optional": true
        },
        {
          "name": "session_escrow",
          "writable": true,
          "optional": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "optional": true,
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": "u64"
        },
        {
          "name": "input_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "answer_mode",
          "type": {
            "defined": {
              "name": "AnswerMode"
            }
          }
        },
        {
          "name": "callback",
          "type": {
            "option": {
              "defined": {
                "name": "CallbackSpec"
              }
            }
          }
        },
        {
          "name": "ceiling",
          "type": "u64"
        }
      ]
    },
    {
      "name": "publish_benchmark",
      "discriminator": [
        193,
        61,
        7,
        139,
        15,
        170,
        132,
        71
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "benchmark",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  101,
                  110,
                  99,
                  104,
                  109,
                  97,
                  114,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "arg",
                "path": "args.name"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "PublishBenchmarkArgs"
            }
          }
        }
      ]
    },
    {
      "name": "publish_measurement",
      "discriminator": [
        86,
        47,
        29,
        38,
        13,
        226,
        134,
        1
      ],
      "accounts": [
        {
          "name": "publisher",
          "writable": true,
          "signer": true
        },
        {
          "name": "measurement",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "digest",
          "type": {
            "array": [
              "u8",
              48
            ]
          }
        },
        {
          "name": "source_repo",
          "type": "string"
        },
        {
          "name": "commit_sha",
          "type": "string"
        },
        {
          "name": "recipe_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "version",
          "type": "string"
        }
      ]
    },
    {
      "name": "publish_version",
      "discriminator": [
        6,
        123,
        155,
        174,
        43,
        89,
        146,
        212
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "model_version"
          ]
        },
        {
          "name": "model_version",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "model_version.version",
                "account": "ModelVersion"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "ciphertext_sha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refresh_enclave",
      "discriminator": [
        186,
        43,
        26,
        36,
        222,
        112,
        250,
        10
      ],
      "accounts": [
        {
          "name": "signing_key",
          "signer": true,
          "relations": [
            "enclave"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signing_key"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "refund_call",
      "discriminator": [
        46,
        165,
        96,
        9,
        152,
        224,
        25,
        51
      ],
      "accounts": [
        {
          "name": "actor",
          "signer": true
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "register_call_referral",
      "discriminator": [
        174,
        215,
        251,
        222,
        255,
        143,
        16,
        70
      ],
      "accounts": [
        {
          "name": "caller",
          "writable": true,
          "signer": true,
          "relations": [
            "call"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "referral_config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "call",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "call_referral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108,
                  45,
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "referral",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "arg",
                "path": "referrer"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "referrer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "register_enclave",
      "discriminator": [
        212,
        174,
        251,
        235,
        52,
        145,
        141,
        168
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true
        },
        {
          "name": "signing_key",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "signing_key"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "encryption_key",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "endpoint",
          "type": "string"
        }
      ]
    },
    {
      "name": "retire_model",
      "discriminator": [
        78,
        251,
        110,
        104,
        96,
        78,
        230,
        80
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "revoke_grant",
      "discriminator": [
        134,
        180,
        57,
        39,
        152,
        7,
        154,
        98
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "grant",
          "writable": true
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": []
    },
    {
      "name": "seal_model",
      "discriminator": [
        130,
        170,
        138,
        45,
        104,
        73,
        50,
        8
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "ciphertext_sha256",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "seal_range",
      "discriminator": [
        236,
        184,
        234,
        164,
        68,
        233,
        228,
        52
      ],
      "accounts": [
        {
          "name": "upload_key",
          "signer": true
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "chunk_count",
          "type": "u32"
        }
      ]
    },
    {
      "name": "seal_version_range",
      "discriminator": [
        59,
        150,
        208,
        207,
        173,
        66,
        216,
        223
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "model_version"
          ]
        },
        {
          "name": "model_version",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "model_version.version",
                "account": "ModelVersion"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "chunk_count",
          "type": "u32"
        }
      ]
    },
    {
      "name": "set_allowed_measurements",
      "discriminator": [
        25,
        78,
        234,
        157,
        110,
        103,
        244,
        59
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "allowed_measurements",
          "type": {
            "vec": {
              "array": [
                "u8",
                48
              ]
            }
          }
        }
      ]
    },
    {
      "name": "set_config",
      "discriminator": [
        108,
        158,
        154,
        175,
        212,
        98,
        52,
        66
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "ConfigArgs"
            }
          }
        }
      ]
    },
    {
      "name": "set_pass_plan",
      "discriminator": [
        129,
        65,
        100,
        143,
        23,
        201,
        26,
        184
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "pass_plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  115,
                  115,
                  45,
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "SetPassPlanArgs"
            }
          }
        }
      ]
    },
    {
      "name": "set_policy",
      "discriminator": [
        40,
        133,
        12,
        157,
        235,
        202,
        2,
        132
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "args",
          "type": {
            "defined": {
              "name": "PolicyArgs"
            }
          }
        }
      ]
    },
    {
      "name": "set_price",
      "discriminator": [
        16,
        19,
        182,
        8,
        149,
        83,
        72,
        181
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "price",
          "type": "u64"
        },
        {
          "name": "price_mint",
          "type": "pubkey"
        },
        {
          "name": "operator_share_bps",
          "type": "u16"
        },
        {
          "name": "price_unit",
          "type": {
            "defined": {
              "name": "PriceUnit"
            }
          }
        }
      ]
    },
    {
      "name": "set_quote",
      "discriminator": [
        59,
        95,
        185,
        175,
        67,
        228,
        200,
        29
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "enclave"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          }
        },
        {
          "name": "grant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  103,
                  114,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "operator_share_bps",
          "type": {
            "option": "u16"
          }
        }
      ]
    },
    {
      "name": "set_referral_config",
      "discriminator": [
        114,
        36,
        32,
        209,
        207,
        21,
        21,
        247
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "referral_config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  102,
                  101,
                  114,
                  114,
                  97,
                  108,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "share_bps",
          "type": "u16"
        },
        {
          "name": "active",
          "type": "bool"
        }
      ]
    },
    {
      "name": "set_split",
      "discriminator": [
        133,
        67,
        66,
        245,
        114,
        175,
        32,
        51
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "split",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  108,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "model"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "recipients",
          "type": {
            "vec": {
              "defined": {
                "name": "SplitRecipientInput"
              }
            }
          }
        }
      ]
    },
    {
      "name": "settle_call",
      "discriminator": [
        58,
        230,
        6,
        58,
        104,
        245,
        154,
        227
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "fee_recipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "owner_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operator_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocol_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "output_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "ed25519_instruction_index",
          "type": "u16"
        },
        {
          "name": "open_answer",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "settle_metered_call",
      "discriminator": [
        135,
        233,
        76,
        116,
        130,
        184,
        85,
        190
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "model",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "enclave",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "call"
          ]
        },
        {
          "name": "attestation_record"
        },
        {
          "name": "call",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  97,
                  108,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "call.caller",
                "account": "Call"
              },
              {
                "kind": "account",
                "path": "call.nonce",
                "account": "Call"
              }
            ]
          }
        },
        {
          "name": "receipt",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  99,
                  101,
                  105,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "call"
              }
            ]
          }
        },
        {
          "name": "caller",
          "writable": true
        },
        {
          "name": "owner",
          "writable": true
        },
        {
          "name": "operator",
          "writable": true
        },
        {
          "name": "fee_recipient",
          "writable": true
        },
        {
          "name": "instructions",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "escrow_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "owner_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "operator_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "protocol_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "caller_tokens",
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "optional": true,
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "count",
          "type": "u64"
        },
        {
          "name": "running_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "signature",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "ed25519_instruction_index",
          "type": "u16"
        }
      ]
    },
    {
      "name": "withdraw_bond",
      "discriminator": [
        222,
        199,
        141,
        31,
        188,
        93,
        155,
        40
      ],
      "accounts": [
        {
          "name": "operator",
          "writable": true,
          "signer": true,
          "relations": [
            "enclave",
            "bond"
          ]
        },
        {
          "name": "enclave",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  99,
                  108,
                  97,
                  118,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "enclave.signing_key",
                "account": "Enclave"
              }
            ]
          },
          "relations": [
            "bond"
          ]
        },
        {
          "name": "bond",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  110,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "enclave"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "amount_lamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "write_version_weights",
      "discriminator": [
        214,
        49,
        206,
        175,
        70,
        25,
        202,
        9
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "model"
          ]
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          },
          "relations": [
            "model_version"
          ]
        },
        {
          "name": "model_version",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  101,
                  114,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "model"
              },
              {
                "kind": "account",
                "path": "model_version.version",
                "account": "ModelVersion"
              }
            ]
          }
        },
        {
          "name": "weights",
          "writable": true
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "write_weights",
      "discriminator": [
        17,
        26,
        177,
        52,
        60,
        99,
        254,
        61
      ],
      "accounts": [
        {
          "name": "upload_key",
          "signer": true
        },
        {
          "name": "model",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  111,
                  100,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "model.name",
                "account": "Model"
              }
            ]
          }
        },
        {
          "name": "weights",
          "writable": true
        },
        {
          "name": "event_authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  95,
                  95,
                  101,
                  118,
                  101,
                  110,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "program"
        }
      ],
      "args": [
        {
          "name": "offset",
          "type": "u32"
        },
        {
          "name": "bytes",
          "type": "bytes"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Benchmark",
      "discriminator": [
        57,
        252,
        33,
        54,
        113,
        141,
        233,
        247
      ]
    },
    {
      "name": "Bond",
      "discriminator": [
        224,
        128,
        48,
        251,
        182,
        246,
        111,
        196
      ]
    },
    {
      "name": "Call",
      "discriminator": [
        62,
        231,
        169,
        58,
        154,
        150,
        83,
        196
      ]
    },
    {
      "name": "CallReferral",
      "discriminator": [
        164,
        188,
        11,
        242,
        52,
        117,
        5,
        186
      ]
    },
    {
      "name": "Config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "Enclave",
      "discriminator": [
        222,
        166,
        223,
        252,
        18,
        3,
        84,
        34
      ]
    },
    {
      "name": "Grant",
      "discriminator": [
        161,
        166,
        11,
        205,
        204,
        135,
        205,
        54
      ]
    },
    {
      "name": "Measurement",
      "discriminator": [
        102,
        58,
        48,
        155,
        68,
        220,
        172,
        169
      ]
    },
    {
      "name": "Model",
      "discriminator": [
        152,
        221,
        247,
        122,
        185,
        125,
        223,
        151
      ]
    },
    {
      "name": "ModelVersion",
      "discriminator": [
        22,
        236,
        9,
        80,
        24,
        101,
        127,
        43
      ]
    },
    {
      "name": "Pass",
      "discriminator": [
        40,
        247,
        140,
        113,
        56,
        14,
        57,
        44
      ]
    },
    {
      "name": "PassPlan",
      "discriminator": [
        194,
        153,
        247,
        119,
        210,
        16,
        50,
        143
      ]
    },
    {
      "name": "Policy",
      "discriminator": [
        222,
        135,
        7,
        163,
        235,
        177,
        33,
        68
      ]
    },
    {
      "name": "Receipt",
      "discriminator": [
        39,
        154,
        73,
        106,
        80,
        102,
        145,
        153
      ]
    },
    {
      "name": "Referral",
      "discriminator": [
        30,
        235,
        136,
        224,
        106,
        107,
        49,
        64
      ]
    },
    {
      "name": "ReferralConfig",
      "discriminator": [
        102,
        148,
        171,
        235,
        148,
        83,
        250,
        140
      ]
    },
    {
      "name": "Session",
      "discriminator": [
        243,
        81,
        72,
        115,
        214,
        188,
        72,
        144
      ]
    },
    {
      "name": "Split",
      "discriminator": [
        166,
        254,
        141,
        46,
        23,
        221,
        129,
        195
      ]
    }
  ],
  "events": [
    {
      "name": "BenchmarkPublished",
      "discriminator": [
        194,
        226,
        244,
        246,
        119,
        165,
        196,
        39
      ]
    },
    {
      "name": "BondDeposited",
      "discriminator": [
        210,
        149,
        47,
        232,
        72,
        128,
        248,
        153
      ]
    },
    {
      "name": "BondSlashed",
      "discriminator": [
        59,
        7,
        252,
        195,
        234,
        156,
        42,
        54
      ]
    },
    {
      "name": "BondWithdrawn",
      "discriminator": [
        111,
        192,
        154,
        231,
        58,
        115,
        130,
        103
      ]
    },
    {
      "name": "CallOpened",
      "discriminator": [
        80,
        97,
        83,
        218,
        46,
        113,
        128,
        51
      ]
    },
    {
      "name": "CallReferralRegistered",
      "discriminator": [
        64,
        224,
        227,
        153,
        217,
        1,
        225,
        217
      ]
    },
    {
      "name": "CallRefunded",
      "discriminator": [
        251,
        135,
        14,
        71,
        98,
        14,
        36,
        55
      ]
    },
    {
      "name": "CallSettled",
      "discriminator": [
        240,
        201,
        54,
        197,
        132,
        33,
        150,
        213
      ]
    },
    {
      "name": "ConfigChanged",
      "discriminator": [
        147,
        25,
        86,
        98,
        98,
        77,
        78,
        192
      ]
    },
    {
      "name": "EnclaveChanged",
      "discriminator": [
        172,
        222,
        157,
        110,
        37,
        32,
        242,
        36
      ]
    },
    {
      "name": "GrantChanged",
      "discriminator": [
        249,
        62,
        42,
        174,
        52,
        50,
        226,
        161
      ]
    },
    {
      "name": "GrantQuoteUpdated",
      "discriminator": [
        146,
        166,
        47,
        92,
        137,
        176,
        27,
        246
      ]
    },
    {
      "name": "MeasurementDeprecated",
      "discriminator": [
        37,
        236,
        155,
        91,
        134,
        208,
        208,
        201
      ]
    },
    {
      "name": "MeasurementPublished",
      "discriminator": [
        172,
        102,
        54,
        149,
        1,
        131,
        76,
        35
      ]
    },
    {
      "name": "ModelAllowedMeasurementsChanged",
      "discriminator": [
        126,
        158,
        15,
        156,
        53,
        232,
        232,
        69
      ]
    },
    {
      "name": "ModelCreated",
      "discriminator": [
        233,
        244,
        157,
        153,
        211,
        252,
        76,
        24
      ]
    },
    {
      "name": "ModelPriceChanged",
      "discriminator": [
        117,
        35,
        157,
        109,
        59,
        62,
        35,
        35
      ]
    },
    {
      "name": "ModelSealed",
      "discriminator": [
        15,
        215,
        238,
        15,
        184,
        75,
        183,
        235
      ]
    },
    {
      "name": "ModelStatusChanged",
      "discriminator": [
        234,
        246,
        98,
        82,
        90,
        240,
        19,
        53
      ]
    },
    {
      "name": "ModelVersionPublished",
      "discriminator": [
        193,
        96,
        36,
        8,
        41,
        6,
        208,
        196
      ]
    },
    {
      "name": "ModelVersionStarted",
      "discriminator": [
        79,
        78,
        143,
        45,
        232,
        156,
        200,
        196
      ]
    },
    {
      "name": "PassClosed",
      "discriminator": [
        122,
        76,
        69,
        52,
        68,
        10,
        33,
        223
      ]
    },
    {
      "name": "PassPlanUpdated",
      "discriminator": [
        166,
        227,
        117,
        122,
        135,
        88,
        80,
        115
      ]
    },
    {
      "name": "PassPurchased",
      "discriminator": [
        11,
        171,
        162,
        118,
        129,
        168,
        151,
        90
      ]
    },
    {
      "name": "PassUsed",
      "discriminator": [
        131,
        42,
        120,
        140,
        122,
        112,
        205,
        177
      ]
    },
    {
      "name": "PolicyCleared",
      "discriminator": [
        113,
        209,
        132,
        14,
        255,
        192,
        12,
        11
      ]
    },
    {
      "name": "PolicyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "RangeSealed",
      "discriminator": [
        134,
        176,
        3,
        229,
        181,
        140,
        220,
        27
      ]
    },
    {
      "name": "ReferralClaimed",
      "discriminator": [
        195,
        109,
        77,
        196,
        134,
        226,
        78,
        108
      ]
    },
    {
      "name": "ReferralConfigUpdated",
      "discriminator": [
        97,
        103,
        139,
        190,
        11,
        212,
        97,
        58
      ]
    },
    {
      "name": "ReferralCredited",
      "discriminator": [
        168,
        129,
        33,
        226,
        83,
        56,
        219,
        73
      ]
    },
    {
      "name": "SessionClosed",
      "discriminator": [
        57,
        237,
        11,
        243,
        194,
        34,
        120,
        27
      ]
    },
    {
      "name": "SessionDebited",
      "discriminator": [
        136,
        108,
        160,
        44,
        177,
        125,
        36,
        109
      ]
    },
    {
      "name": "SessionOpened",
      "discriminator": [
        34,
        79,
        77,
        95,
        195,
        207,
        104,
        223
      ]
    },
    {
      "name": "SplitClaimed",
      "discriminator": [
        234,
        11,
        44,
        178,
        141,
        137,
        23,
        193
      ]
    },
    {
      "name": "SplitCredited",
      "discriminator": [
        215,
        244,
        242,
        85,
        233,
        26,
        109,
        122
      ]
    },
    {
      "name": "SplitUpdated",
      "discriminator": [
        110,
        85,
        143,
        135,
        98,
        156,
        185,
        91
      ]
    },
    {
      "name": "WeightsAttached",
      "discriminator": [
        225,
        95,
        252,
        229,
        1,
        207,
        233,
        95
      ]
    },
    {
      "name": "WeightsWritten",
      "discriminator": [
        231,
        48,
        23,
        136,
        234,
        185,
        86,
        45
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "Unauthorized",
      "msg": "Only the configured authority may perform this action."
    },
    {
      "code": 6001,
      "name": "InvalidConfig",
      "msg": "Protocol configuration is invalid."
    },
    {
      "code": 6002,
      "name": "InvalidModel",
      "msg": "Model metadata or cipher format is invalid."
    },
    {
      "code": 6003,
      "name": "ModelNotUploading",
      "msg": "The model is not uploading."
    },
    {
      "code": 6004,
      "name": "ModelNotSealed",
      "msg": "Seal the model before granting it."
    },
    {
      "code": 6005,
      "name": "ModelNotLive",
      "msg": "The model does not accept new calls."
    },
    {
      "code": 6006,
      "name": "InvalidWeights",
      "msg": "The weights accounts do not match the model."
    },
    {
      "code": 6007,
      "name": "InvalidWrite",
      "msg": "The upload has a gap or an out-of-range write."
    },
    {
      "code": 6008,
      "name": "UploadIncomplete",
      "msg": "Every weights byte must be written before sealing."
    },
    {
      "code": 6009,
      "name": "CiphertextHashMismatch",
      "msg": "The ciphertext hash does not match."
    },
    {
      "code": 6010,
      "name": "InvalidAttestation",
      "msg": "The attestation record is invalid or expired."
    },
    {
      "code": 6011,
      "name": "MeasurementNotAllowed",
      "msg": "The enclave measurement is not allowed by this model."
    },
    {
      "code": 6012,
      "name": "InvalidEnclave",
      "msg": "The enclave registration does not match its attestation."
    },
    {
      "code": 6013,
      "name": "InvalidWrappedKey",
      "msg": "The wrapped key must be a version 1 envelope of 105 bytes."
    },
    {
      "code": 6014,
      "name": "GrantRequired",
      "msg": "The enclave does not hold an active grant."
    },
    {
      "code": 6015,
      "name": "CallNotOpen",
      "msg": "The call has already settled or been refunded."
    },
    {
      "code": 6016,
      "name": "CallDeadlinePassed",
      "msg": "The call settlement deadline has passed."
    },
    {
      "code": 6017,
      "name": "CallNotRefundable",
      "msg": "The call deadline has not passed."
    },
    {
      "code": 6018,
      "name": "InvalidSignature",
      "msg": "The required Ed25519 verification instruction is missing or does not match."
    },
    {
      "code": 6019,
      "name": "InvalidTokenAccount",
      "msg": "The escrow mint or token accounts are invalid."
    },
    {
      "code": 6020,
      "name": "InvalidRecipient",
      "msg": "A payment recipient does not match the call snapshot."
    },
    {
      "code": 6021,
      "name": "InsufficientEscrow",
      "msg": "The escrow cannot cover the requested payment."
    },
    {
      "code": 6022,
      "name": "ArithmeticOverflow",
      "msg": "An arithmetic limit was exceeded."
    },
    {
      "code": 6023,
      "name": "InvalidOpenAnswer",
      "msg": "The open answer bytes are empty, exceed the configured limit, or do not match the output hash."
    },
    {
      "code": 6024,
      "name": "InvalidCallback",
      "msg": "The callback specification or remaining accounts are invalid."
    },
    {
      "code": 6025,
      "name": "InvalidCall",
      "msg": "The call pricing unit or escrow ceiling is invalid for this instruction."
    },
    {
      "code": 6026,
      "name": "InvalidMeasurement",
      "msg": "The measurement digest, source metadata, or status is invalid."
    },
    {
      "code": 6027,
      "name": "InvalidPolicy",
      "msg": "The model policy limits, callers, operators, or regions are invalid."
    },
    {
      "code": 6028,
      "name": "PolicyCallerDenied",
      "msg": "The caller is not on this model's allow list."
    },
    {
      "code": 6029,
      "name": "PolicyOperatorDenied",
      "msg": "The enclave operator is not allowed by this model's policy."
    },
    {
      "code": 6030,
      "name": "PolicyRequired",
      "msg": "This model has an active policy; pass its Policy account in remaining accounts."
    },
    {
      "code": 6031,
      "name": "InvalidQuote",
      "msg": "The quoted operator share exceeds the model's maximum operator share."
    },
    {
      "code": 6032,
      "name": "InvalidVersion",
      "msg": "The model version is invalid or not in the required state."
    },
    {
      "code": 6033,
      "name": "InvalidSession",
      "msg": "The caller session is closed, expired, out of budget, or does not match this call."
    },
    {
      "code": 6034,
      "name": "InvalidSplit",
      "msg": "The revenue split configuration, remaining account, or claim is invalid."
    },
    {
      "code": 6035,
      "name": "InvalidBond",
      "msg": "The operator bond deposit, withdrawal, or remaining account is invalid."
    },
    {
      "code": 6036,
      "name": "InvalidBenchmark",
      "msg": "The benchmark name, dataset, score, or receipt proofs are invalid."
    },
    {
      "code": 6037,
      "name": "InvalidPass",
      "msg": "The pass plan or prepaid pass is invalid, inactive, expired, or exhausted."
    },
    {
      "code": 6038,
      "name": "InvalidReferral",
      "msg": "The referral config, call referral, or referral claim is invalid."
    }
  ],
  "types": [
    {
      "name": "AnswerMode",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Sealed"
          },
          {
            "name": "Open"
          }
        ]
      }
    },
    {
      "name": "BeginVersionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "Benchmark",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "model_version",
            "type": "u32"
          },
          {
            "name": "dataset_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "dataset_uri",
            "type": "string"
          },
          {
            "name": "sample_count",
            "type": "u32"
          },
          {
            "name": "passed_count",
            "type": "u32"
          },
          {
            "name": "score_bps",
            "type": "u16"
          },
          {
            "name": "receipts",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "published_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "BenchmarkPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "benchmark",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "model_version",
            "type": "u32"
          },
          {
            "name": "dataset_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "dataset_uri",
            "type": "string"
          },
          {
            "name": "sample_count",
            "type": "u32"
          },
          {
            "name": "passed_count",
            "type": "u32"
          },
          {
            "name": "score_bps",
            "type": "u16"
          },
          {
            "name": "receipts",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "published_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Bond",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "bonded_lamports",
            "type": "u64"
          },
          {
            "name": "slashed_total",
            "type": "u64"
          },
          {
            "name": "missed_calls",
            "type": "u64"
          },
          {
            "name": "slash_bps",
            "type": "u16"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "BondDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bonded_lamports",
            "type": "u64"
          },
          {
            "name": "slash_bps",
            "type": "u16"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "BondSlashed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bonded_lamports",
            "type": "u64"
          },
          {
            "name": "slashed_total",
            "type": "u64"
          },
          {
            "name": "missed_calls",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "BondWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bond",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "bonded_lamports",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Call",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "opened_slot",
            "type": "u64"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "CallStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          },
          {
            "name": "callback_program",
            "type": "pubkey"
          },
          {
            "name": "callback_accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "CallbackAccount"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CallOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "opened_slot",
            "type": "u64"
          },
          {
            "name": "deadline_slot",
            "type": "u64"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          },
          {
            "name": "callback_program",
            "type": "pubkey"
          },
          {
            "name": "callback_accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "CallbackAccount"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          },
          {
            "name": "ceiling",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CallReferral",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "share_bps",
            "type": "u16"
          },
          {
            "name": "settled",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "CallReferralRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call_referral",
            "type": "pubkey"
          },
          {
            "name": "referral",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "share_bps",
            "type": "u16"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CallRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "CallStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "CallSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "output_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "signature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "owner_amount",
            "type": "u64"
          },
          {
            "name": "operator_amount",
            "type": "u64"
          },
          {
            "name": "protocol_amount",
            "type": "u64"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "open_answer",
            "type": "bytes"
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          },
          {
            "name": "delivered_count",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "returned_amount",
            "type": {
              "option": "u64"
            }
          }
        ]
      }
    },
    {
      "name": "CallStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Settled"
          },
          {
            "name": "Refunded"
          }
        ]
      }
    },
    {
      "name": "CallbackAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pubkey",
            "type": "pubkey"
          },
          {
            "name": "is_writable",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "CallbackSpec",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "program",
            "type": "pubkey"
          },
          {
            "name": "accounts",
            "type": {
              "vec": {
                "defined": {
                  "name": "CallbackAccount"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "Config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "attestation_program",
            "type": "pubkey"
          },
          {
            "name": "record_layout_version",
            "type": "u8"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "call_deadline_slots",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "max_open_answer_bytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ConfigArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "attestation_program",
            "type": "pubkey"
          },
          {
            "name": "record_layout_version",
            "type": "u8"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "protocol_share_bps",
            "type": "u16"
          },
          {
            "name": "call_deadline_slots",
            "type": "u64"
          },
          {
            "name": "max_open_answer_bytes",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "ConfigChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "ConfigArgs"
              }
            }
          }
        ]
      }
    },
    {
      "name": "CreateModelArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "upload_funding_lamports",
            "type": "u64"
          },
          {
            "name": "extra_upload_key_count",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "Enclave",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "signing_key",
            "type": "pubkey"
          },
          {
            "name": "encryption_key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "attestation_record",
            "type": "pubkey"
          },
          {
            "name": "hardware_type",
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recorded_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          },
          {
            "name": "calls_settled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "EnclaveChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "signing_key",
            "type": "pubkey"
          },
          {
            "name": "encryption_key",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "endpoint",
            "type": "string"
          },
          {
            "name": "record",
            "type": "pubkey"
          },
          {
            "name": "hardware_type",
            "type": "u8"
          },
          {
            "name": "measurement",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "recorded_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Grant",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrapped_key",
            "type": "bytes"
          },
          {
            "name": "granted_by",
            "type": "pubkey"
          },
          {
            "name": "granted_slot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "quoted_operator_share_bps",
            "type": {
              "option": "u16"
            }
          }
        ]
      }
    },
    {
      "name": "GrantChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "grant",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "wrapped_key",
            "type": "bytes"
          },
          {
            "name": "granted_by",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "revoked",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "GrantQuoteUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "quoted_operator_share_bps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Measurement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "source_repo",
            "type": "string"
          },
          {
            "name": "commit_sha",
            "type": "string"
          },
          {
            "name": "recipe_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "created_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MeasurementStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "MeasurementDeprecated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MeasurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "MeasurementPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "measurement",
            "type": "pubkey"
          },
          {
            "name": "digest",
            "type": {
              "array": [
                "u8",
                48
              ]
            }
          },
          {
            "name": "publisher",
            "type": "pubkey"
          },
          {
            "name": "source_repo",
            "type": "string"
          },
          {
            "name": "commit_sha",
            "type": "string"
          },
          {
            "name": "recipe_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "version",
            "type": "string"
          },
          {
            "name": "created_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "MeasurementStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "MeasurementStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Active"
          },
          {
            "name": "Deprecated"
          }
        ]
      }
    },
    {
      "name": "Model",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "docs": [
              "Pubkey::default() denotes native SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "upload_key",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "ModelStatus"
              }
            }
          },
          {
            "name": "created_slot",
            "type": "u64"
          },
          {
            "name": "sealed_slot",
            "type": "u64"
          },
          {
            "name": "calls_settled",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "upload_keys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hash_version",
            "type": "u8"
          },
          {
            "name": "sealed_chunks",
            "type": "u32"
          },
          {
            "name": "merkle_frontier",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "merkle_frontier_mask",
            "type": "u32"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          },
          {
            "name": "has_policy",
            "type": "bool"
          },
          {
            "name": "current_version",
            "type": "u32"
          },
          {
            "name": "has_split",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ModelAllowedMeasurementsChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelBase",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "format",
            "type": "string"
          },
          {
            "name": "source",
            "type": "string"
          }
        ]
      }
    },
    {
      "name": "ModelCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "cipher",
            "type": "string"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "allowed_measurements",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  48
                ]
              }
            }
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "upload_key",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "upload_keys",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "hash_version",
            "type": "u8"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelPriceChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "price",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "operator_share_bps",
            "type": "u16"
          },
          {
            "name": "price_unit",
            "type": {
              "defined": {
                "name": "PriceUnit"
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "base_sha256",
            "type": {
              "option": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Uploading"
          },
          {
            "name": "Sealed"
          },
          {
            "name": "Live"
          },
          {
            "name": "Retired"
          }
        ]
      }
    },
    {
      "name": "ModelStatusChanged",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "ModelStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "ModelVersion",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "VersionStatus"
              }
            }
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "hash_version",
            "type": "u8"
          },
          {
            "name": "sealed_chunks",
            "type": "u32"
          },
          {
            "name": "merkle_frontier",
            "type": {
              "vec": {
                "array": [
                  "u8",
                  32
                ]
              }
            }
          },
          {
            "name": "merkle_frontier_mask",
            "type": "u32"
          },
          {
            "name": "published_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ModelVersionPublished",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "model_version",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "previous_version",
            "type": "u32"
          },
          {
            "name": "previous_ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "previous_size_bytes",
            "type": "u64"
          },
          {
            "name": "previous_sealed_slot",
            "type": "u64"
          },
          {
            "name": "previous_base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "ciphertext_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "published_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ModelVersionStarted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "model_version",
            "type": "pubkey"
          },
          {
            "name": "version",
            "type": "u32"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "size_bytes",
            "type": "u64"
          },
          {
            "name": "nonce_prefix",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          },
          {
            "name": "manifest",
            "type": "bytes"
          },
          {
            "name": "base",
            "type": {
              "option": {
                "defined": {
                  "name": "ModelBase"
                }
              }
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "OpenSessionArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          },
          {
            "name": "delegate_gas_lamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Pass",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "price_per_call",
            "type": "u64"
          },
          {
            "name": "calls_total",
            "type": "u32"
          },
          {
            "name": "calls_used",
            "type": "u32"
          },
          {
            "name": "escrow_remaining",
            "type": "u64"
          },
          {
            "name": "purchased_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "PassStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PassClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "closer",
            "type": "pubkey"
          },
          {
            "name": "returned_amount",
            "type": "u64"
          },
          {
            "name": "calls_used",
            "type": "u32"
          },
          {
            "name": "calls_total",
            "type": "u32"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "PassStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "PassPlan",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "price_per_call",
            "type": "u64"
          },
          {
            "name": "min_calls",
            "type": "u32"
          },
          {
            "name": "max_calls",
            "type": "u32"
          },
          {
            "name": "ttl_slots",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PassPlanUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass_plan",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "price_per_call",
            "type": "u64"
          },
          {
            "name": "min_calls",
            "type": "u32"
          },
          {
            "name": "max_calls",
            "type": "u32"
          },
          {
            "name": "ttl_slots",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PassPurchased",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "price_per_call",
            "type": "u64"
          },
          {
            "name": "calls_total",
            "type": "u32"
          },
          {
            "name": "escrow_remaining",
            "type": "u64"
          },
          {
            "name": "purchased_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PassStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Closed"
          }
        ]
      }
    },
    {
      "name": "PassUsed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pass",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "calls_used",
            "type": "u32"
          },
          {
            "name": "calls_total",
            "type": "u32"
          },
          {
            "name": "escrow_remaining",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Policy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allow_list_enabled",
            "type": "bool"
          },
          {
            "name": "allowed_callers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "max_calls_per_caller_per_window",
            "type": "u32"
          },
          {
            "name": "window_slots",
            "type": "u64"
          },
          {
            "name": "allowed_operators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowed_regions",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "updated_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PolicyArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "allow_list_enabled",
            "type": "bool"
          },
          {
            "name": "allowed_callers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "max_calls_per_caller_per_window",
            "type": "u32"
          },
          {
            "name": "window_slots",
            "type": "u64"
          },
          {
            "name": "allowed_operators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowed_regions",
            "type": {
              "vec": "string"
            }
          }
        ]
      }
    },
    {
      "name": "PolicyCleared",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PolicyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "allow_list_enabled",
            "type": "bool"
          },
          {
            "name": "allowed_callers",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "max_calls_per_caller_per_window",
            "type": "u32"
          },
          {
            "name": "window_slots",
            "type": "u64"
          },
          {
            "name": "allowed_operators",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowed_regions",
            "type": {
              "vec": "string"
            }
          },
          {
            "name": "updated_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PriceUnit",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Call"
          },
          {
            "name": "Token"
          }
        ]
      }
    },
    {
      "name": "PublishBenchmarkArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "dataset_sha256",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "dataset_uri",
            "type": "string"
          },
          {
            "name": "sample_count",
            "type": "u32"
          },
          {
            "name": "passed_count",
            "type": "u32"
          },
          {
            "name": "score_bps",
            "type": "u16"
          },
          {
            "name": "receipts",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "RangeSealed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "start_chunk",
            "type": "u32"
          },
          {
            "name": "chunk_count",
            "type": "u32"
          },
          {
            "name": "sealed_chunks",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "Receipt",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "enclave",
            "type": "pubkey"
          },
          {
            "name": "input_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "output_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "signature",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "price_mint",
            "type": "pubkey"
          },
          {
            "name": "total",
            "type": "u64"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "operator",
            "type": "pubkey"
          },
          {
            "name": "fee_recipient",
            "type": "pubkey"
          },
          {
            "name": "owner_amount",
            "type": "u64"
          },
          {
            "name": "operator_amount",
            "type": "u64"
          },
          {
            "name": "protocol_amount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "answer_mode",
            "type": {
              "defined": {
                "name": "AnswerMode"
              }
            }
          },
          {
            "name": "open_answer",
            "type": "bytes"
          },
          {
            "name": "caller_is_program",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "Referral",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "total_earned",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          },
          {
            "name": "calls_referred",
            "type": "u64"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ReferralClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referral",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "total_claimed",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ReferralConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "share_bps",
            "type": "u16"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ReferralConfigUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referral_config",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "share_bps",
            "type": "u16"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "ReferralCredited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "referral",
            "type": "pubkey"
          },
          {
            "name": "call_referral",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "referrer",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "total_earned",
            "type": "u64"
          },
          {
            "name": "calls_referred",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "Session",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "calls_opened",
            "type": "u64"
          },
          {
            "name": "opened_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "SessionStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "SessionClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "closer",
            "type": "pubkey"
          },
          {
            "name": "returned_amount",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "calls_opened",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "SessionStatus"
              }
            }
          }
        ]
      }
    },
    {
      "name": "SessionDebited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "spent",
            "type": "u64"
          },
          {
            "name": "calls_opened",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SessionOpened",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "session",
            "type": "pubkey"
          },
          {
            "name": "caller",
            "type": "pubkey"
          },
          {
            "name": "delegate",
            "type": "pubkey"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "opened_slot",
            "type": "u64"
          },
          {
            "name": "expires_at_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SessionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Closed"
          }
        ]
      }
    },
    {
      "name": "SetPassPlanArgs",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "price_per_call",
            "type": "u64"
          },
          {
            "name": "min_calls",
            "type": "u32"
          },
          {
            "name": "max_calls",
            "type": "u32"
          },
          {
            "name": "ttl_slots",
            "type": "u64"
          },
          {
            "name": "active",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "Split",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "total_received",
            "type": "u64"
          },
          {
            "name": "updated_slot",
            "type": "u64"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "SplitRecipient"
                }
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "SplitClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "split",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "total_claimed",
            "type": "u64"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SplitCredited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "split",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "call",
            "type": "pubkey"
          },
          {
            "name": "receipt",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "total_received",
            "type": "u64"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "SplitRecipient"
                }
              }
            }
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SplitRecipient",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "share_bps",
            "type": "u16"
          },
          {
            "name": "accrued",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "SplitRecipientInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "wallet",
            "type": "pubkey"
          },
          {
            "name": "share_bps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "SplitUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "split",
            "type": "pubkey"
          },
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "active",
            "type": "bool"
          },
          {
            "name": "recipients",
            "type": {
              "vec": {
                "defined": {
                  "name": "SplitRecipient"
                }
              }
            }
          },
          {
            "name": "updated_slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "VersionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Uploading"
          },
          {
            "name": "Live"
          },
          {
            "name": "Archived"
          }
        ]
      }
    },
    {
      "name": "WeightsAttached",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": {
              "vec": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "WeightsWritten",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "model",
            "type": "pubkey"
          },
          {
            "name": "weights",
            "type": "pubkey"
          },
          {
            "name": "offset",
            "type": "u32"
          },
          {
            "name": "length",
            "type": "u32"
          },
          {
            "name": "written_bytes",
            "type": "u32"
          }
        ]
      }
    }
  ]
} as unknown as Voynich
