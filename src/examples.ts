export const examples: Record<string, string> = {
  hello: "; xCASL2 / WCASL2 compatibility core\nMAIN     START\n         LAD     GR1,1\n         ADDA    GR1,=2\n         OUT     MSG,LEN\n         RET\nMSG      DC      'HELLO, CASL II!'\nLEN      DC      15\n         END\n",
  echo: "; IN and OUT preserve GR1 / GR2 through macro expansion\nMAIN     START\n         IN      BUF,LEN\n         LD      GR0,LEN\n         CPA     GR0,=0\n         JMI     FIN\n         OUT     BUF,LEN\nFIN      RET\nBUF      DS      128\nLEN      DS      1\n         END\n",
  sum: "; Sum 1 through 10. GR1 = 55 (#0037)\nMAIN     START\n         LAD     GR1,0\n         LAD     GR2,10\nLOOP     ADDL    GR1,GR2\n         SUBL    GR2,=1\n         JNZ     LOOP\n         RET\n         END\n",
  files: "; Select file devices. Read records until EOF.\nMAIN     START\nNEXT     IN      BUF,LEN\n         LD      GR0,LEN\n         CPA     GR0,=0\n         JMI     FIN\n         OUT     BUF,LEN\n         JUMP    NEXT\nFIN      RET\nBUF      DS      256\nLEN      DS      1\n         END\n",
};
